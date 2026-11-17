# Runbook deploy — S1 (fondasi company / RLS)

## Urutan (jangan dibalik)

1. **Backup** database produksi (snapshot + uji restore). Migrasi S1 menambah kolom `NOT NULL` + backfill; tidak ada down script.
2. Set environment di Vercel: `DATABASE_URL`, `FILE_SIGNING_SECRET` (≥ 32 char acak). Pastikan `SEED_DEMO_PASSWORD` **tidak** diset di production.
3. Jalankan migrasi dari mesin yang punya akses DB (bukan dari Vercel runtime):
   ```bash
   npm ci
   cp .env.example .env.local   # isi DATABASE_URL produksi
   npm run db:migrate
   npm run db:verify
   ```
4. Deploy aplikasi (`git push` ke branch yang terhubung Vercel).
5. Smoke test: `GET /api/health` → `{"ok":true}`; login akun admin; buka menu **Pengguna**; undang user uji; terima undangan lewat `/accept-invite?token=...`.
6. Rotasi `FILE_SIGNING_SECRET` bila sebelumnya pernah kosong (signed URL lama otomatis invalid).

## Verifikasi acceptance S1

| # | Kriteria | Cara |
|---|---|---|
| 1 | Build hijau tanpa env DB | `env -u DATABASE_URL npm run build` |
| 2 | `typecheck` / `lint` / `test` hijau | `npm run typecheck && npm run lint && npm test` |
| 3 | Migrasi dari DB **pra-S1** (skema 28 tabel sudah ada) | `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify`. SQL juga dieksekusi otomatis di CI oleh `tests/unit/migrations.test.ts` memakai Postgres in-process (PGlite), tanpa server eksternal |
| 4 | Isolasi company | `npm run db:verify` (4 pemeriksaan), `npm test` (uji SQL + RLS via PGlite), atau `EPC_RLS_TEST=1 npm test` untuk integrasi ke DB nyata |
| 5 | Tidak ada akun demo di production | `grep -r 'DemoEPC2026' src` → 0 hasil; seed hanya `scripts/seed-demo.ts` |
| 6 | Tidak ada secret nyata di repo | `git check-ignore -v .env.local` → `.gitignore:6:.env.*`; `git grep -nE 'FILE_SIGNING_SECRET=[A-Za-z0-9+/=_-]{32,}' -- ':!.env.example'` → 0 hasil |
| 7 | Payload tidak membocorkan PII | login `FIELD`, cek `curl /` tidak memuat NPWP/email user lain/nilai kontrak |
| 8 | Role matrix | `npm test -- tests/unit/rbac.test.ts` |
| 9 | Audit append-only | `npm run db:verify` (pemeriksaan ke-4) |
| 10 | Dependency aman | `npm audit --omit=dev --audit-level=high` → 0 critical/high |

## Variabel environment

| Variabel | Wajib | Catatan |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled (`-pooler`) + `sslmode=require`. Pakai koneksi **transaction pooler** bila memakai Supabase. |
| `FILE_SIGNING_SECRET` | ✅ prod | ≥ 32 karakter; `openssl rand -hex 32`. Tanpa ini production gagal di request pertama. |
| `PG_POOL_MAX` | ⛔ | default 10; turunkan bila memakai pooler dengan batas koneksi ketat. |
| `SEED_DEMO_PASSWORD` | ⛔ | Jangan diset di production. |
| `ALLOW_DEMO_SEED` | ⛔ | `yes` hanya di environment uji. |
| `EPC_RLS_TEST` | ⛔ | `1` untuk menjalankan test integrasi RLS. |

## Catatan operasional & risiko sisa

- **Koneksi pool + `SET LOCAL`**: `withCompany()` membungkus tiap request dalam transaksi. Jangan menambah query di luar `companyRoute()`/`withCompany()` — RLS akan menolaknya (fail-closed).
- **`_migrations`** mencatat file yang sudah diterapkan; jangan mengedit file SQL yang sudah terpakai, buat file baru.
- **Control-plane belum di-RLS** (`users`, `sessions`, `companies`, `memberships`, `invitations`, `auth_events`, katalog). Akses dijaga di aplikasi; pemisahan role DB direncanakan S2.
- **Token undangan** belum dikirim email — admin menyalin tautan manual. Integrasi email/SSO menyusul.
- **Rate limit login** berbasis tabel `auth_events`; belum ada lockout per akun/MFA.
- **`npm audit --omit=dev`** masih menyisakan 2 temuan *moderate* pada `exceljs`/`uuid` (tidak ada patch tanpa major downgrade). Risiko diterima sadar; dievaluasi saat sprint QA.
- **Signed URL file** tetap 5 menit dan file masih berupa `base64` di DB — migrasi ke object storage ada di S3 (Field Photos).
