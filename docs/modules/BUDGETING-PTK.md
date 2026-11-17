# Modul S2a — RAB, Baseline, Pagu & PTK

*Dikerjakan 2026-11-17 sebagai vertical slice ke-2 setelah S1 (PR #13). Rujukan: `docs/AUDIT-EPC-2026-11-17.md` §10.*

## 1. Tujuan & alur utuh

```
Estimator/PM buat versi RAB (CLIENT / INTERNAL) + pos
  → SUBMIT (REVIEW) → APPROVE → SET_BASELINE (terkunci, tunggal)
  → realisasi per pos dicek pagu 90% / 100%
  → PTK ADD / OMIT / SUBSTITUTE dengan dampak BERTANDA
  → SUBMIT → INTERNAL_REVIEW → AWAITING_CLIENT → APPROVED
  → IMPLEMENT: revisi baseline + SATU nilai kontrak berjalan
  → rekalkulasi termin persentase + retensi + audit diff per pos
```

## 2. Keputusan desain (dan penyimpangan sadar dari §10.5)

| Keputusan | Alasan |
|---|---|
| **`budget_lines` adalah satu-satunya tabel pos RAB**; tidak dibuat tabel `rab_items` duplikat | Skema existing sudah memakai `budget_lines` sejak awal. Membuat tabel baru akan menduplikasi sumber kebenaran dan memaksa backfill lintas 24 tabel. §10.5 menyebut `rab_items` sebagai *konsep*, bukan nama fisik. Hook `category_id` (sudah ada), `keywords`, `wbs_item_id` ditambahkan di sini untuk S6/S5. |
| **`po_items` ditunda ke S2b** | Sesuai keputusan memecah S2 menjadi S2a/S2b agar tetap satu vertical slice per iterasi. |
| **`projects.contract_value_current` = satu sumber nilai kontrak** | `finance.ts` tidak lagi menjumlah `change_orders`. Trigger DB menghitung `contract_value + CO approved + PTK approved/implemented`. `change_orders` lama TETAP ADA sebagai adapter (tidak ada fitur yang dihapus). |
| **RAB internal dijaga policy `AS RESTRICTIVE` (AND)** | Menambah policy *permissive* akan di-OR dengan 4 policy isolasi company dan justru **membocorkan** data company lain. RESTRICTIVE digabung AND sehingga aman. Butuh GUC `app.current_permissions` yang di-`SET LOCAL` di transaksi sama dengan `app.current_company_id`. Tanpa GUC → RAB internal 0 baris (**fail-closed**). |
| **Kolom turunan dihitung DB** | `computed_total`, `contingency_amount`, `pagu_amount` adalah *generated columns*. `total` lama tidak diubah, jadi migrasi non-destruktif. Kolom ini sengaja **tidak dipetakan Drizzle** agar kloning baris lama (`IMPLEMENT_CHANGE_ORDER`) tidak menulis kolom generated. |
| **Baseline immutable** | `locked_at` + transisi `BASELINE: {}`. Revisi selalu membuat versi baru; partial unique index `budget_one_active_baseline_idx` menolak dua baseline aktif. |
| **Kontingensi akhirnya dipakai** | `contingency_pct` (B3) menaikkan pagu: `pagu = total × (1 + contingency/100)`. |
| **Template `PTK_ADDENDUM` ditunda ke S4** | Audit melarang *hardcode template di kode*; `src/lib/document-templates.ts` masih hardcoded. Template PTK akan dibuat saat Document Generator memindahkan template ke DB/admin. S2a hanya menyiapkan datanya (`client_reference`, `client_approved_at/by`, `evidence_file_id`, daftar pos tambah/kurang). |
| **`contract_terms.invoiced_amount` / status & pencegahan double-invoice (B5) ditunda ke S2b** | S2a sudah merekalkulasi termin persentase dengan **guard**: termin tidak diturunkan di bawah nilai yang sudah ditagihkan. Status/invoiced amount permanen masuk S2b. |

## 3. Migrasi `drizzle/0002_s2a_budgeting_ptk.sql`

- `app_has_permission(text)` + GUC `app.current_permissions`.
- `budget_lines`: 3 generated column + `line_status`, `variation_action`, `source_variation_id`, `wbs_item_id`, `keywords`.
- `budget_versions`: `revision_note`, `locked_at`, `superseded_by`, `source_variation_id`, `created_from_version_id`.
- `projects.contract_value_current` + backfill **per company** (RLS `FORCE` sudah aktif sejak 0001, sehingga scope dipindah per company, bukan satu `UPDATE` global) + CHECK `>= 0`.
- `recalculate_project_contract_value()` + 4 trigger (`change_orders`, `variation_orders`, `projects.contract_value`, dan `projects` AFTER INSERT agar proyek baru tidak ber-`contract_value_current = 0`).
- Tabel baru: `variation_orders`, `variation_order_lines`, `budget_phasing` — semuanya `ENABLE + FORCE RLS` + 4 policy company.
- Trigger `assert_budget_line_project()` pada `expense_lines` & `purchase_records`: menolak `budget_line_id` lintas proyek (B3).
- 2 policy **RESTRICTIVE** pada `budget_versions` / `budget_lines` (B9).
- Katalog minimum `cost_categories` + `units` (idempoten) agar editor RAB bisa dipakai di DB existing.

Total: **27 tabel ber-RLS**, **110 policy** (108 isolasi + 2 restrictive).

## 4. API

| Method | Path | Izin | Fungsi |
|---|---|---|---|
| `POST` | `/api/budgets` | `budget.edit` | Buat versi DRAFT + pos (validasi kategori/satuan/`total = qty × harga`) |
| `GET` | `/api/budgets/[id]` | sesi | Baca versi + pos |
| `PATCH` | `/api/budgets/[id]` | `budget.edit` | Revisi **DRAFT** saja, wajib catatan revisi, audit diff per pos |
| `POST` | `/api/budgets/[id]/action` | sesuai aksi | `SUBMIT` / `APPROVE` / `RETURN` / `REJECT` / `SET_BASELINE` |
| `POST` | `/api/variations` | `variation.edit` | Buat PTK DRAFT; dampak harga/biaya/waktu **signed**, jumlah pos harus sama dengan header |
| `POST` | `/api/variations/[id]/action` | sesuai aksi | `SUBMIT` / `SEND_CLIENT` / `APPROVE` / `REJECT` / `CANCEL` / `IMPLEMENT` |

`POST /api/expenses` dan `POST /api/purchases` mendapat field opsional `overBudgetReason` + pemeriksaan `enforcePagu()`:
- `> 90%` → warning tersimpan di `duplicateReason`/audit.
- `> 100%` → `422 BUDGET_LIMIT_EXCEEDED` kecuali ada alasan ≥5 karakter **dan** izin `budget.approve`; persetujuan dicatat di audit.

Semua route dibungkus `companyRoute()` (S1), jadi satu request = satu transaksi = `SET LOCAL` company + permissions.

## 5. Matriks peran (keputusan #7)

| Peran | RAB internal | Buat/revisi RAB | Approve/baseline | Ajukan PTK | Setujui/implementasi PTK |
|---|:---:|:---:|:---:|:---:|:---:|
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| PM | ✅ | ✅ | ✅ | ✅ | ✅ |
| FINANCE | ✅ | ⛔ | ✅ | ⛔ | ✅ |
| ESTIMATOR | ⛔ | ✅ (CLIENT) | ⛔ | ✅ | ⛔ |
| PROCUREMENT / FIELD | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| CLIENT_VIEWER | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

`CLIENT_VIEWER` hanya melihat PTK tanpa `costImpact` dan tanpa `lines` (redaksi DTO di `workspace.ts`).

## 6. Acceptance criteria

| # | Kriteria | Cara |
|---|---|---|
| 1 | Migrasi 0002 bisa dieksekusi dari DB pra-S2a | `npm test -- tests/unit/migrations.test.ts` (PGlite): 27 tabel FORCE RLS, 110 policy, backfill kontrak, generated column, trigger, fail-closed |
| 2 | Baseline tunggal & immutable | test `partial unique index` + `BUDGET_TRANSITIONS.BASELINE = {}` |
| 3 | Pagu 90/100/110% benar dengan `Decimal` | `npm test -- tests/unit/budgeting.test.ts` |
| 4 | PTK dampak negatif diterima, ADD negatif ditolak | test Zod `createVariationSchema` |
| 5 | Satu sumber nilai kontrak | `npm test -- tests/unit/finance.test.ts` + test trigger PTK APPROVED/CANCELLED/negatif |
| 6 | RAB internal hanya ADMIN/PM/FINANCE | test matriks peran + policy RESTRICTIVE fail-closed |
| 7 | `budgetLineId` lintas proyek ditolak | test trigger `expense_lines` |
| 8 | Build tanpa `DATABASE_URL` tetap hijau | `env -u DATABASE_URL npm run build` |
| 9 | typecheck / lint / test / audit | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |
| 10 | DB nyata | `npm run db:migrate` → `npm run db:verify` → smoke test UI tab **RAB & PTK** |

## 7. Risiko sisa / yang belum dikerjakan

- **Belum ada server Postgres di sandbox**: seluruh SQL diuji pada PGlite; `npm run db:migrate`/`db:verify` ke Neon tetap prasyarat deploy.
- **`FORCE RLS` + policy RESTRICTIVE**: script SQL manual yang tidak menyetel `app.current_permissions` akan melihat 0 baris RAB internal. Ini disengaja (fail-closed).
- **PTK `IMPLEMENT`** membuat revisi untuk **setiap** baseline aktif (CLIENT + INTERNAL); bila salah satu belum ada, hanya yang ada yang direvisi. Pastikan kedua baseline ditetapkan sebelum PTK.
- **`evidence_file_id`** masih memakai `file_objects` base64 (S3 akan pindah ke object storage).
- **`PTK_ADDENDUM`**, `po_items`, `invoiced_amount` termin, email/SSO undangan, MFA, CSP nonce — di luar S2a.
- **UI** memakai `window.prompt` untuk alasan `RETURN`/`REJECT`/`CANCEL`; akan diganti inline form saat sprint QA.
- **Keanggotaan proyek**: `requireProject()` (S1) mewajibkan baris `project_members` untuk peran non-ADMIN. `scripts/seed-demo.ts` sekarang mengisinya; database produksi wajib memastikan data ini ada, kalau tidak PM/Estimator/Finance tidak melihat proyek maupun modul S2a. Ini temuan lama di luar perubahan skema S2a, tidak mengubah aturan otorisasi.
