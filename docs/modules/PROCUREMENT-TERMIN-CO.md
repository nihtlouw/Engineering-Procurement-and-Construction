# S2b — PO berbasis pos, termin anti double-invoice, dan CO lama

Dokumen ini menjelaskan irisan kedua setelah S2a. Fokusnya menutup temuan audit §10.5 (PO tidak punya pos / rekonsiliasi penerimaan) dan B5 (termin dapat ditagihkan berulang), sekaligus memperbaiki implementasi *change order* lama tanpa menghapus adapter S1/S2a.

> Status: **implementasi kode + PGlite selesai**. Migrasi `0003` **belum** dijalankan ke database nyata; lihat [runbook deploy](../runbook/DEPLOY.md).

## 1. Keputusan desain

| Keputusan | Alasan |
|---|---|
| `po_items` adalah tabel baru; tidak mengubah `budget_lines` | Pos RAB tetap satu-satunya sumber anggaran; pos PO adalah komitmen/penerimaan terhadap pos RAB |
| PO lama di-backfill menjadi **satu** pos | Non-destruktif; `PO_BILL` lama tetap punya referensi dan jalur audit tidak putus |
| `purchase_records.dpp_amount` diturunkan dari jumlah `po_items.dpp_amount` saat `items` dikirim | Menghindari dua sumber nilai PO. Jalur lama tanpa `items` tetap diterima untuk kompatibilitas |
| `received_qty` kumulatif per pos, `0 ≤ received_qty ≤ quantity` | Penerimaan parsial didukung; penerimaan tidak bisa melebihi pesanan |
| `PO_BILL` dicek terhadap `received_qty × unit_amount` per pos | Tagihan tidak boleh mendahului barang diterima; akumulasi approved + incoming dibandingkan per pos |
| `contract_terms.invoiced_amount` dijaga trigger DB | Satu sumber kumulatif tagihan; service tidak boleh menghitung ulang secara drift-prone |
| Status termin `OPEN → PARTIALLY_INVOICED → INVOICED`, `CLOSED` manual | Status otomatis mengikuti invoice, tetapi keputusan tutup termin tetap manusia |
| Pagu termin **dan** pagu `projects.contract_value_current` | Mencegah double-invoice baik pada satu termin maupun lintas termin/invoice tanpa termin |
| Over-invoice = alasan ≥5 karakter **+** `invoice.approve` | Fail-closed di service **dan** trigger DB; GUC permission kosong tidak bisa meloloskan |
| CO lama dipertahankan, bukan dihapus | `recalculate_project_contract_value()` S2a masih menjumlah `change_orders` status `APPROVED`/`IMPLEMENTED` |
| Perubahan baru tetap via `variation_orders` | PTK S2a punya dampak bertanda, bukti klien, baris, dan audit diff yang lebih lengkap |

## 2. Skema & migrasi `0003`

File: `drizzle/0003_s2b_po_terms_co.sql`.

### Tabel & kolom baru

- `po_items(id, company_id, purchase_record_id, budget_line_id, description, quantity, unit_code, unit_amount, dpp_amount, received_qty, sort_order)`.
  - CHECK: `quantity > 0`, `received_qty` di antara 0 dan `quantity`, `dpp_amount = round(quantity × unit_amount, 2)`.
  - `company_id DEFAULT app_current_company_id()`, `ENABLE` + `FORCE RLS`, 4 policy isolasi.
  - Composite FK `(company_id, purchase_record_id) → purchase_records(company_id, id)`.
- `expense_lines.po_item_id` nullable + composite FK `(company_id, po_item_id) → po_items(company_id, id)`.
- `purchase_records.received_at` / `closed_at`.
- `contract_terms.invoiced_amount`, `status`, `is_auto_amount`.
- `customer_invoices.over_invoice_reason` + composite FK `(company_id, contract_term_id) → contract_terms(company_id, id)`.
- `change_orders`: `variation_type`, `client_reference`, `client_approved_at/by`, `evidence_file_id`, `cancel_reason`, `cancelled_at`, `superseded_by_variation_id`.

### Backfill per company

`DO $$ ... LOOP` menyetel `SET LOCAL app.current_company_id` untuk setiap `companies.id`, lalu:

1. Membuat satu `po_items` untuk setiap `purchase_records` yang belum punya pos. `received_qty = 1` hanya untuk status `RECEIVED` / `CLOSED`; status lain tetap 0.
2. Mengisi `contract_terms.invoiced_amount` dari `SUM(customer_invoices.total_amount)` dengan `status <> 'CANCELLED'`.
3. Menurunkan `contract_terms.status`.

GUC company **dan** permission di-reset di akhir blok agar koneksi migrasi tidak mewarisi scope. Karena 24 tabel lama sudah `FORCE RLS`, backfill tanpa GUC akan menghasilkan 0 baris; ini disengaja.

### Trigger

| Trigger | Fungsi |
|---|---|
| `contract_terms_status_recalc` | `BEFORE UPDATE OF amount, invoiced_amount`; menghitung ulang status, kecuali `CLOSED` |
| `customer_invoices_term_recalc` | `AFTER INSERT/UPDATE/DELETE`; memanggil `recalc_contract_term_invoiced()` untuk termin lama & baru |
| `customer_invoices_term_limit` | `BEFORE INSERT/UPDATE`; menolak pagu termin/kontrak terlampaui kecuali alasan + `app_has_permission('invoice.approve')` |
| `po_items_scope` / `expense_lines_po_item_scope` | Menolak pos PO / baris tagihan lintas company atau proyek, serta ketidaksesuaian `budgetLineId` |

`assert_invoice_term_limit()` selalu mengecek pagu kontrak, termasuk invoice dengan `contract_term_id = NULL`. Invoice `CANCELLED` dilewati. `COALESCE(contract_value_current, contract_value, 0)` dipakai agar DB pra-S2a yang belum ter-backfill tetap fail-closed.

## 3. Service & validasi

Modul: `src/modules/procurement/{types,validation,service}.ts`.

- `createPoItemsSchema`: minimal 1, maksimal 200 pos; volume > 0, harga satuan ≥ 0, uraian ≥ 3 karakter.
- `normalizePoItems()`: memastikan `budgetLineId` berasal dari **baseline aktif proyek yang sama** dan `lineStatus = ACTIVE`, lalu memanggil `enforcePagu()` per pos.
- `insertPoItems()`: menulis `dpp_amount` dari `lineTotal()` (Decimal, 2 desimal).
- `receivePurchase()`: transisi `ORDERED`/`PARTIALLY_RECEIVED`; menolak `receivedQty < receivedQty lama` atau `> quantity`; menentukan `RECEIVED` bila semua pos penuh, else `PARTIALLY_RECEIVED`; menulis audit diff.
- `enforcePoBillItems()`: untuk PO yang punya pos, **setiap baris `PO_BILL` wajib `poItemId`**; menjumlah incoming per pos, membandingkan `approved billed + incoming` dengan nilai barang diterima.
- `evaluateTermLimit()` murni untuk unit test; `enforceTermLimit()` membaca project/termin/invoice aktif dan mengembalikan warning over-invoice yang sudah disetujui.

### API yang berubah

| Endpoint | Perubahan |
|---|---|
| `POST /api/purchases` | Menerima `items[]`; DPP header divalidasi sama dengan jumlah pos; pagu dicek per pos; `budgetLineId` header diambil dari pos pertama untuk kompatibilitas |
| `POST /api/purchases/[id]/action` | Aksi baru `{ action: "RECEIVE", items: [{ itemId, receivedQty }] }`; transisi status lama tetap hidup |
| `POST /api/expenses` | `lines[].poItemId`; untuk `PO_BILL` memanggil `enforcePoBillItems()`; header PO lama tetap dicek |
| `POST /api/invoices` | `overInvoiceReason`; memanggil `enforceTermLimit()` sebelum insert; trigger DB menjadi guard kedua |
| `POST /api/change-orders` | Zod `coItemSchema`: `variationType`, dampak harga/biaya/waktu **bertanda**, `clientReference`, `evidenceFileId`, guard nilai kontrak tidak negatif |
| `POST /api/change-orders/[id]/action` | `CANCEL` dengan alasan; mencatat `cancelledAt`, `clientApprovedAt/By`; nilai kontrak turun lewat trigger S2a |
| `POST /api/projects/[id]/action` | `IMPLEMENT_CHANGE_ORDER`: kategori dari katalog aktif (bukan `cat-civ`), dampak waktu bertanda + guard tidak sebelum `startDate`, revisi baseline lengkap, audit diff dampak |
| `variation_orders IMPLEMENT` (S2a) | Menghormati `isAutoAmount`, `invoicedAmount`, `status INVOICED/CLOSED` saat rekalkulasi termin |

## 4. UI

Tab baru **PO & Termin** (`src/modules/procurement/ui/ProcurementPanel.tsx`) menampilkan:

- kartu pagu kontrak + status/invoiced amount per termin;
- daftar PO dengan tabel pos, qty pesan/diterima, harga satuan, DPP, dan kode pos RAB;
- modal **Buat PO berbasis pos** dengan pilihan pos baseline RAB;
- modal **Catat penerimaan per pos**;
- daftar CO lama dengan jenis perubahan, referensi klien, dan tombol batal.

Panel lama tetap ada. `PurchaseComposer` lama kini mengirim satu pos otomatis, `ExpenseComposer` menambahkan pilihan pos PO untuk `PO_BILL`, `InvoiceComposer` menambahkan alasan over-invoice + indikator pagu, dan panel Change Order lama mendukung dampak negatif, bukti klien, serta pembatalan.

## 5. Matriks peran singkat

| Aksi | Izin |
|---|---|
| Lihat PO/pos/termin | `purchase.view` / `invoice.view` / `budget.client.view` (DTO sudah diproyeksikan) |
| Buat PO, catat penerimaan | `purchase.edit` |
| Catat `PO_BILL` | `expense.create` |
| Buat invoice | `invoice.edit` |
| Meloloskan over-invoice | `invoice.approve` **+** alasan ≥5 karakter |
| Buat/ubah CO lama | `changeorder.edit` |
| Setujui/batalkan CO, implementasi | `changeorder.approve` |
| Lihat RAB internal / dampak biaya CO | `budget.internal.view` (policy RESTRICTIVE) |

`CLIENT_VIEWER` tidak menerima `purchases`, `invoices`, `terms`, atau `changeOrders` dari `getWorkspaceData()`.

## 6. Acceptance & pengujian

- `npm run typecheck`, `npm run lint`, `npm test`, `env -u DATABASE_URL npm run build`.
- `npm test -- tests/unit/migrations.test.ts`: 24 test PGlite menjalankan `0000 → 0003`, termasuk 28 tabel FORCE RLS / 114 policy, backfill, CHECK qty, pagu termin, pagu kontrak, over-invoice, status termin, trigger lintas proyek, dan isolasi company.
- `npm test -- tests/unit/procurement.test.ts`: 8 test untuk `evaluateTermLimit()`, Zod pos PO/penerimaan/CO, dan konstanta status/transisi.
- `npm audit --omit=dev --audit-level=high`: 0 critical/high (2 moderate `uuid` / `exceljs` tetap diterima sadar).

**Belum diverifikasi**: `npm run db:migrate` / `db:verify` / seed / smoke HTTP terhadap Neon/Supabase nyata. Vercel tidak menjalankan migrasi dari runtime; `0002` dan `0003` wajib dijalankan manual setelah backup.

## 7. Risiko & yang sengaja ditunda

- `0003` forward-only, tanpa down script. Pulihkan dari backup bila perlu.
- Trigger `customer_invoices_term_limit` membutuhkan `SET LOCAL app.current_permissions`. SQL manual tanpa GUC tidak bisa over-invoice, dan RAB internal tidak terlihat.
- `expense_lines.po_item_id` sengaja nullable untuk data lama; constraint composite `ON DELETE RESTRICT` berarti pos PO yang sudah ditagihkan tidak bisa dihapus sebelum baris tagihan dibersihkan.
- Pagu kontrak memakai `projects.contract_value_current`; baya CO/PTK lama harus tetap lewat trigger S2a agar tidak double-count.
- `PTK_ADDENDUM`, portal vendor, cashflow otomatis, approval bertingkat, import Excel, EVM lengkap, pajak masa, multi-currency, HSE/QC/NCR, dan S3–S6 tetap di luar S2b.
