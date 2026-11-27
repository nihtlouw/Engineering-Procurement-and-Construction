# Termin kontrak & katalog biaya (tahap 3)

Status: **selesai** — migrasi `0007_terms_catalog.sql`, API, dan UI Master Data.
Menutup dua celah audit DOM-01: termin kontrak yang tadinya hanya bisa dibuat lewat
`scripts/seed-demo.ts`, dan katalog `cost_categories`/`units` yang hanya global.

## Masalah yang diselesaikan

| Sebelum | Sesudah |
|---|---|
| Termin hanya dari seed; PM ubah jadwal tagihan = developer | Tab **Master Data → Termin**: tambah/ubah/hapus/urutkan termin per proyek, komposisi persen dijaga 100% |
| Kategori biaya & satuan hanya baris global (`company_id NULL`), tidak bisa ditambah company | Tab **Master Data → Katalog**: kategori & satuan milik company, kode unik per company, baris bersama read-only |
| Tidak ada cara menutup termin yang tidak akan ditagih | Aksi **Tutup** (status `CLOSED`) dengan alasan wajib, teraudit |
| `contract_terms.sort_order` bebas bertabrakan | UNIQUE `(company_id, project_id, sort_order)` |

## Migrasi `0007_terms_catalog.sql`

Forward-only, non-destruktif, tanpa backfill.

1. `contract_terms`:
   - `notes text` (catatan syarat penagihan),
   - UNIQUE `contract_terms_project_sort_idx (company_id, project_id, sort_order)`,
   - index `contract_terms_project_idx (company_id, project_id, type)`,
   - `trg_contract_terms_status_recalc` ditulis ulang: status `CLOSED` tidak pernah
     ditimpa otomatis, `OPEN`/`PARTIALLY_INVOICED`/`INVOICED` tetap dihitung dari
     `invoiced_amount` vs `amount`.
2. `cost_categories` & `units`:
   - UNIQUE global `code` dilepas (dicari lewat `pg_constraint` pada `conkey` = `code`),
   - UNIQUE parsial `(company_id, code) WHERE company_id IS NOT NULL`,
   - `created_by_id` (FK `users`), `created_at`.
   - Baris lama dengan `company_id NULL` **dibiarkan** = katalog bersama untuk semua company.

Catatan RLS: kedua tabel katalog sengaja **tanpa RLS** (lihat `0001`), sehingga
`listCatalog()` memfilter company secara eksplisit:
`company_id IS NULL OR company_id = <company aktif>`.

## Aturan domain

### Termin (`src/modules/master-data/{types,validation,service}.ts`)

- Jenis: `DP | MOS | PROGRESS | FINAL | RETENTION | OTHER`. Maksimal **40** termin per proyek.
- Satu baris wajib punya **persen** atau **nominal** (XOR longgar: bila persen diisi,
  nominal dihitung server). Persen 0,01–100 dengan maksimal 2 desimal.
- `summarizeTermComposition()`: bila ada termin persen, totalnya harus **100% ± 0,01**;
  termin nominal murni tidak diwajibkan 100%. Campuran persen + nominal diperbolehkan.
- `assertSingleRetention()`: maksimal **satu** termin `RETENTION` per proyek.
- Simpan = **replace-by-set** (`saveContractTerms`) dalam satu transaksi:
  1. tolak bila proyek `isLocked` dan aktor bukan ADMIN (`PROJECT_LOCKED` 409),
  2. tolak retensi ganda (`RETENTION_DUPLICATE` 422) dan komposisi salah (`TERM_PERCENT_TOTAL` 422),
  3. termin dengan `invoiced_amount > 0` tidak boleh dihapus (`TERM_HAS_INVOICES` 409),
  4. nilai persen dihitung dari `projects.contract_value_current` (bukan nilai dasar),
     sehingga CO/PTK otomatis menggeser pagu termin,
  5. nominal baru tidak boleh di bawah tagihan yang sudah ada (`TERM_BELOW_INVOICED` 422),
  6. baris lama digeser ke slot `sort_order + 1000` lebih dulu agar UNIQUE per proyek
     tidak bentrok saat reorder, lalu ditulis dengan urutan final,
  7. semua perubahan dicatat ke `activity_logs` (`CONTRACT_TERM` / `TERMS_SAVED`).
- `closeContractTerm()` → status `CLOSED`, alasan wajib ≥ 5 karakter (`requiredReason`),
  audit `CLOSED`. Termin `CLOSED` tidak dibuka kembali otomatis oleh trigger.
- Ubah/tutup termin butuh `invoice.edit` **atau** `budget.approve` (FINANCE, PM, ADMIN)
  dan `requireProject()` (anggota proyek, proyek tidak terkunci).
- `listContractTerms()` memakai `requireProject()` (bukan `invoice.view`) sehingga
  termin tidak bocor ke peran lapangan yang bukan anggota proyek, dan menyertakan
  `invoiceCount` (invoice non-`CANCELLED`) per termin.

### Katalog

- Tulis katalog butuh `settings.manage` **atau** `budget.edit`.
- Baris `company_id IS NULL` = katalog bersama → **read-only** (`SHARED_CATALOG_READONLY` 409).
- Kode unik per company (`DUPLICATE_CODE` 409). Kode kategori dinormalisasi ke huruf
  besar sebelum validasi (2–24 karakter: `A-Z0-9._-`).
- Kode kategori tidak dapat diubah bila sudah dipakai `budget_lines` (`CATEGORY_IN_USE` 409);
  kode satuan **selalu** tidak dapat diubah (`CODE_IMMUTABLE` 409), hanya `name`
  (kategori juga `isOverhead`/`isActive`) yang dapat disunting.
- `listCatalog(user)` mengembalikan `shared` dan `used` per baris agar UI bisa
  menonaktifkan tombol ubah.

## API

| Method & path | Fungsi | Izin |
|---|---|---|
| `GET /api/projects/[id]/terms` | daftar termin + `invoiceCount` | `requireProject` |
| `PUT /api/projects/[id]/terms` | simpan daftar termin (replace-by-set) | `invoice.edit` \| `budget.approve` + anggota proyek |
| `POST /api/projects/[id]/terms/[termId]` | `{ action: "CLOSE", reason }` | `invoice.edit` \| `budget.approve` + anggota proyek |
| `GET /api/catalog/categories` | kategori + satuan (sekali muat untuk dua panel) | login |
| `POST /api/catalog/categories` · `PATCH /api/catalog/categories/[id]` | buat/ubah kategori | `settings.manage` \| `budget.edit` |
| `POST /api/catalog/units` · `PATCH /api/catalog/units/[id]` | buat/ubah satuan | `settings.manage` \| `budget.edit` |

Semua route memakai `companyRoute()` → satu request = satu transaksi `withCompany()`
(RLS aktif). Kode error yang dipakai UI: `PROJECT_LOCKED`, `RETENTION_DUPLICATE`,
`TERM_PERCENT_TOTAL`, `TERM_HAS_INVOICES`, `TERM_BELOW_INVOICED`, `DUPLICATE_CODE`,
`CATEGORY_IN_USE`, `CODE_IMMUTABLE`, `SHARED_CATALOG_READONLY`, `NOT_FOUND`.

## UI (`src/components/master-data/`)

- `TermsTab.tsx` — pilih proyek, ringkasan (nilai kontrak berjalan, total persen,
  sudah ditagihkan), editor baris termin (jenis, nama, persen/nominal, pemicu,
  target tanggal, catatan), tombol **Skema standar 30/20/40/10**, indikator
  komposisi 100%, tombol **Tutup** untuk termin bertagihan.
- `CatalogTab.tsx` — dua panel (kategori biaya, satuan) dengan badge
  "Katalog bersama" / "Milik company" / "dipakai RAB"; form tambah/ubah dalam modal.
- Keduanya dipasang sebagai tab `Termin` dan `Katalog` di `MasterDataView.tsx`
  (izin UI: `invoice.edit` untuk termin; `settings.manage`/`budget.edit` untuk katalog).
- Pola React Compiler: data dimuat lewat `useCallback` + `useEffect` **tanpa**
  `setState` sinkron di body effect; state `null` = belum termuat.

## Uji

- `tests/unit/migrations.test.ts` (37 test) — baseline PGlite yang meniru skema pra-S1
  menjalankan `0000 → 0007`; blok `0007` memeriksa UNIQUE urutan per proyek,
  status termin, kode katalog per company, dan index/kolom baru.
- `tests/unit/terms-catalog.test.ts` (10 test) — komposisi persen (30/20/40/10, toleransi
  0,01), retensi tunggal, validasi persen/nominal, batas 40 termin, alasan penutupan,
  normalisasi kode kategori & validasi satuan.
- Total suite: **122 passed / 3 skipped** (integrasi RLS butuh `EPC_RLS_TEST=1` + `DATABASE_URL`).

## Risiko & batasan

- Katalog bersama tidak dapat diubah dari UI; bila company butuh variasi, buat baris
  baru dengan kode berbeda (mis. `MAT2`) — bukan pengganti ideal, tetapi aman.
- Penutupan termin memakai `window.prompt` (sama seperti 5 alasan lain, UX-02);
  penggantian ke dialog modal masih terbuka.
- `cost_categories`/`units` tetap tanpa RLS; isolasi bergantung pada filter eksplisit
  di service (sudah diuji migration + `verify-rls`).
- Belum ada bulk import katalog (CSV) dan belum ada pemakaian satuan per kategori.
