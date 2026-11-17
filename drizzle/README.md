# Migrasi database

Migrasi SQL **berversi dan wajib** — `drizzle-kit push` hanya untuk percobaan lokal, tidak dipakai lagi di CI/production.

| File | Isi |
|---|---|
| `0000_tenant_foundation.sql` | `companies`, `memberships`, `invitations`, `auth_events`, `company_id` + backfill non-destruktif pada 24 tabel bisnis, FK, index, unique partial index baseline, view `audit_logs`, trigger immutability |
| `0001_rls_policies.sql` | `ENABLE` + **`FORCE` ROW LEVEL SECURITY** dan policy SELECT/INSERT/UPDATE/DELETE per company |

## Perintah

```bash
cp .env.example .env.local      # isi DATABASE_URL
npm run db:migrate              # terapkan yang belum ada (satu transaksi per file)
npm run db:migrate -- --check   # lihat yang tertunda tanpa mengubah
npm run db:verify               # uji isolasi 2 company + audit append-only
```

Runner mencatat nama file pada tabel `_migrations`. Migration yang gagal di-**rollback** penuh.

> **Catatan:** file ini adalah migrasi *increment* atas skema 28 tabel pra-S1 (dulu dibuat lewat `drizzle-kit push`), bukan pembuatan skema dari nol. `tests/unit/migrations.test.ts` meniru skema pra-S1 tersebut di Postgres in-process, lalu mengeksekusi kedua file SQL dan menguji RLS — jadi CI memverifikasi SQL tanpa butuh Neon/Supabase.

## Cara kerja isolasi

```sql
-- di-set oleh withCompany() di dalam SATU transaksi per request:
SELECT set_config('app.current_company_id', '<uuid>', true);  -- true = SET LOCAL
```

- Fungsi `app_current_company_id()` dipakai sebagai `DEFAULT company_id` dan oleh seluruh policy.
- `FORCE` diperlukan karena user DB yang menjalankan migrasi juga **pemilik tabel**; tanpa `FORCE`, owner melewati RLS.
- Tanpa scope, `app_current_company_id()` = NULL → `SELECT` mengembalikan 0 baris dan `INSERT` gagal (`NOT NULL`). **Fail-closed.**
- Jangan pernah memakai `SET` (session-level) pada koneksi pool: nilainya bisa terbawa ke request berikutnya.

## Yang sengaja TIDAK di-RLS (S1)

`users`, `sessions`, `companies`, `memberships`, `invitations`, `auth_events`, `cost_categories`, `units` adalah **control-plane**: identitas global dipakai untuk menentukan scope sebelum RLS bisa diterapkan. Aksesnya dijaga `requireUser()` + `users.manage` + filter `company_id` eksplisit di `src/modules/companies/service.ts`. Pemisahan role DB direncanakan S2.

## Urutan deploy

1. Backup database.
2. `npm run db:migrate` (0000 lalu 0001, otomatis).
3. `npm run db:verify`.
4. Deploy aplikasi.
5. Cek `/api/health` dan login salah satu akun.

Rollback: migrasi ini **tidak memiliki down script** karena menambah kolom + backfill. Pulihkan dari backup bila perlu; jangan menghapus kolom `company_id` sembari aplikasi baru berjalan.
