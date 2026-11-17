# Migrasi database

Migrasi SQL **berversi dan wajib** — `drizzle-kit push` hanya untuk percobaan lokal, tidak dipakai lagi di CI/production.

| File | Isi |
|---|---|
| `0000_tenant_foundation.sql` | `companies`, `memberships`, `invitations`, `auth_events`, `company_id` + backfill non-destruktif pada 24 tabel bisnis, FK, index, unique partial index baseline, view `audit_logs`, trigger immutability |
| `0001_rls_policies.sql` | `ENABLE` + **`FORCE` ROW LEVEL SECURITY** dan policy SELECT/INSERT/UPDATE/DELETE per company |
| `0002_s2a_budgeting_ptk.sql` | S2a: kolom turunan pos RAB, `projects.contract_value_current` (satu sumber nilai kontrak) + trigger, `variation_orders` / `variation_order_lines` / `budget_phasing`, trigger `budgetLineId` lintas proyek, katalog minimum, dan 2 policy **RESTRICTIVE** untuk RAB internal |
| `0003_s2b_po_terms_co.sql` | S2b: `po_items` + RLS, backfill PO lama per company, `expense_lines.po_item_id`, `contract_terms.invoiced_amount/status/is_auto_amount`, `customer_invoices.over_invoice_reason`, kolom bukti/pembatalan CO lama, trigger kumulatif termin, pagu termin/kontrak, dan integritas company/project |
| `0004_s3_field_photos.sql` | S3: `file_objects.content_base64` nullable + metadata storage, tabel `field_photos` / `document_photo_links`, composite company FK, trigger kesamaan proyek, dan `FORCE RLS` pada 2 tabel baru |

## Perintah

```bash
cp .env.example .env.local      # isi DATABASE_URL
npm run db:migrate              # terapkan yang belum ada (satu transaksi per file)
npm run db:migrate -- --check   # lihat yang tertunda tanpa mengubah
npm run db:verify               # uji isolasi 2 company + audit append-only
```

Runner mencatat nama file pada tabel `_migrations`. Migration yang gagal di-**rollback** penuh.

> **Catatan:** file ini adalah migrasi *increment* atas skema 28 tabel pra-S1 (dulu dibuat lewat `drizzle-kit push`), bukan pembuatan skema dari nol. `tests/unit/migrations.test.ts` meniru skema pra-S1 tersebut di Postgres in-process, lalu mengeksekusi seluruh file SQL dan menguji RLS — jadi CI memverifikasi SQL tanpa butuh Neon/Supabase.

## Cara kerja isolasi

```sql
-- di-set oleh withCompany() di dalam SATU transaksi per request:
SELECT set_config('app.current_company_id', '<uuid>', true);  -- true = SET LOCAL
```

- Fungsi `app_current_company_id()` dipakai sebagai `DEFAULT company_id` dan oleh seluruh policy.
- `FORCE` diperlukan karena user DB yang menjalankan migrasi juga **pemilik tabel**; tanpa `FORCE`, owner melewati RLS.
- Tanpa scope, `app_current_company_id()` = NULL → `SELECT` mengembalikan 0 baris dan `INSERT` gagal (`NOT NULL`). **Fail-closed.**
- Jangan pernah memakai `SET` (session-level) pada koneksi pool: nilainya bisa terbawa ke request berikutnya.
- S2a menambah GUC kedua: `app.current_permissions` (daftar izin dipisah koma), juga `SET LOCAL` di transaksi yang sama. Tanpa itu policy RESTRICTIVE RAB internal bersifat **fail-closed** (0 baris). S2b memakai GUC yang sama untuk `app_has_permission('invoice.approve')` pada trigger anti double-invoice; SQL manual tanpa GUC tidak dapat meloloskan over-invoice.
- Setelah `0004`, total tabel bisnis ber-RLS = **30** dengan **122 policy** (120 isolasi + 2 RESTRICTIVE). Backfill `0003` berjalan per company di bawah FORCE RLS, lalu GUC di-reset agar koneksi migrasi tidak mewarisi scope. Foto baru S3 tidak memakai `content_base64`; file lama/PDF final tetap provider `DB`.

## Yang sengaja TIDAK di-RLS (S1)

`users`, `sessions`, `companies`, `memberships`, `invitations`, `auth_events`, `cost_categories`, `units` adalah **control-plane**: identitas global dipakai untuk menentukan scope sebelum RLS bisa diterapkan. Aksesnya dijaga `requireUser()` + `users.manage` + filter `company_id` eksplisit di `src/modules/companies/service.ts`. Pemisahan role DB direncanakan S2.

## Urutan deploy

1. Backup database.
2. `npm run db:migrate` (0000 → 0001 → 0002 → 0003 → 0004, otomatis).
3. `npm run db:verify`.
4. Deploy aplikasi.
5. Cek `/api/health` dan login salah satu akun.

Rollback: migrasi ini **tidak memiliki down script** karena menambah kolom, tabel, constraint, dan backfill. `0004` juga forward-only. Pulihkan dari backup bila perlu; jangan menghapus kolom `company_id` sembari aplikasi baru berjalan.
