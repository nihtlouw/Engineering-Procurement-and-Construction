# Runbook deploy — S1 / S2a / S2b / S3 / hardening-1

## Urutan (jangan dibalik)

1. **Backup** database produksi (snapshot + uji restore). Migrasi S1 menambah kolom `NOT NULL` + backfill; tidak ada down script.
2. Set environment di Vercel: `DATABASE_URL`, `FILE_SIGNING_SECRET` (≥ 32 char acak), dan untuk S3 `FILE_STORAGE_DRIVER=s3` + kredensial bucket privat. Pastikan `SEED_DEMO_PASSWORD` **tidak** diset di production.
3. Jalankan migrasi dari mesin yang punya akses DB (bukan dari Vercel runtime). Runner otomatis menerapkan `0000 → 0001 → 0002 → 0003 → 0004 → 0005`:
   ```bash
   npm ci
   cp .env.example .env.local   # isi DATABASE_URL produksi
   npm run db:migrate -- --check
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

## Deploy S2a (RAB + baseline + pagu + PTK)

`0002_s2a_budgeting_ptk.sql` bersifat **increment** atas DB yang sudah memakai 0000/0001. Backup tetap wajib: migrasi menambah kolom `NOT NULL`, generated column, dan trigger, serta **tidak punya down script**.

Urutan: `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy aplikasi → smoke test tab **RAB & PTK**.

| # | Kriteria S2a | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0004 tereksekusi (30 tabel FORCE RLS, 122 policy) | `npm test -- tests/unit/migrations.test.ts` (PGlite, tanpa server DB) |
| 2 | `contract_value_current` ter-backfill dari CO approved lama | test migrasi `backfill contract_value_current` |
| 3 | Baseline tunggal & immutable | test `partial unique index` + `BUDGET_TRANSITIONS` |
| 4 | Pagu 90% / 100% / 110% benar (Decimal) | `npm test -- tests/unit/budgeting.test.ts` |
| 5 | PTK dampak negatif diterima; ADD negatif ditolak | test Zod `createVariationSchema` |
| 6 | Satu sumber nilai kontrak; PTK APPROVED/CANCELLED mengubah kontrak | `npm test -- tests/unit/finance.test.ts` + test trigger migrasi |
| 7 | RAB internal hanya ADMIN/PM/FINANCE (fail-closed tanpa GUC) | test matriks peran + policy RESTRICTIVE |
| 8 | `budgetLineId` lintas proyek ditolak | test trigger `expense_lines` |
| 9 | Build / typecheck / lint / test / audit hijau | lihat tabel S1 + `env -u DATABASE_URL npm run build` |
| 10 | Smoke UI | buat RAB DRAFT → submit → approve → baseline → buat PTK → approve → implementasi; cek revisi baseline & nilai kontrak |

Rincian: [`docs/modules/BUDGETING-PTK.md`](../modules/BUDGETING-PTK.md).

## Deploy S2b (PO + termin + CO lama)

`0003_s2b_po_terms_co.sql` adalah migrasi **forward-only** atas DB yang sudah memakai 0000/0001/0002. Backup wajib: ia menambah tabel `po_items`, kolom `NOT NULL`, constraint, trigger, dan melakukan backfill per company. **Tidak ada down script.**

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy aplikasi → smoke test tab **PO & Termin**.

| # | Kriteria S2b | Cara |
|---|---|---|
| 1 | `0003`/`0004` lolos dari DB pra-S1 tanpa server eksternal | `npm test -- tests/unit/migrations.test.ts` (28 test PGlite) |
| 2 | Backfill PO lama jadi satu pos, termin terisi dari invoice existing | test `backfill PO lama menjadi satu pos` |
| 3 | `qty diterima <= qty pesan` | test CHECK `po_item_received_bounds` |
| 4 | Pagu termin + kontrak fail-closed; over-invoice butuh alasan + `invoice.approve` | `npm test -- tests/unit/procurement.test.ts` + test trigger PGlite |
| 5 | Status termin mengikuti invoice & perubahan amount | test `recalc_contract_term_invoiced` / `contract_terms_status_recalc` |
| 6 | `PO_BILL` wajib per pos dan tidak boleh menagih barang belum diterima | `enforcePoBillItems()` + trigger `expense_lines_po_item_scope` |
| 7 | CO lama bisa dibatalkan; dampak bertanda; tidak ada hardcode kategori | smoke UI + `npm test` |
| 8 | Build / typecheck / lint / test / audit hijau | lihat tabel S1 |
| 9 | Smoke UI | buat PO berbasis pos → catat penerimaan sebagian → buat invoice melebihi termin (harus ditolak) → ulangi dengan alasan + akun `invoice.approve` → cek status termin |

Rincian: [`docs/modules/PROCUREMENT-TERMIN-CO.md`](../modules/PROCUREMENT-TERMIN-CO.md).

## Deploy S3 (Foto lapangan → PDF laporan)

`0004_s3_field_photos.sql` **forward-only**: `content_base64` menjadi nullable, metadata storage ditambahkan, serta 2 tabel baru mendapat `FORCE RLS`. Backup wajib; **tidak ada down script**.

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → isi environment storage produksi → deploy aplikasi → smoke test tab **Foto Lapangan**.

| # | Kriteria S3 | Cara |
|---|---|---|
| 1 | `0004` lolos dari DB pra-S1, 30 FORCE RLS / 122 policy | `npm test -- tests/unit/migrations.test.ts` (28 test PGlite) |
| 2 | Validasi 5 MB, MIME + magic bytes, normalisasi JPEG | `npm test -- tests/unit/field-photos.test.ts` (11 test) |
| 3 | Filter tanggal inklusif, kategori, selectedOnly | test `filter tanggal & kategori` + smoke UI |
| 4 | Foto baru tidak menyimpan base64 di DB | cek `file_objects.content_base64 IS NULL AND storage_provider='S3'` setelah unggah |
| 5 | Signed/presigned URL 5 menit; bucket privat | cek header/URL galeri; tidak ada public-read bucket |
| 6 | `FIELD` hanya proyek sendiri; `CLIENT_VIEWER` hanya foto terpilih | smoke 2 akun + `requireProject()` / DTO workspace |
| 7 | `BEFORE/PROCESS/AFTER` muncul dalam PDF final | generate `PROGRESS_REPORT` → preview → `FINALIZE` → unduh PDF |
| 8 | Build / typecheck / lint / test / audit hijau | lihat tabel S1 |
| 9 | Smoke produksi S3 | unggah 3 kategori, filter batas tanggal, pilih foto, generate, finalisasi, revisi; lampiran revisi tetap sama |

Rincian: [`docs/modules/FIELD-PHOTOS.md`](../modules/FIELD-PHOTOS.md). **S4 Document Generator penuh tidak termasuk rilis ini.**

## Deploy hardening-1 (`0005_hardening_invoice_notifications.sql`)

Migrasi **forward-only**, non-destruktif: menambah `customer_invoices.created_by_id`
(+ backfill dari `activity_logs`), fungsi `app_current_user_id()`, dan 2 policy
RESTRICTIVE pada `notifications`. Backup tetap wajib (backfill mengubah data).

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify`
→ deploy aplikasi → smoke test.

| # | Kriteria hardening-1 | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0005 tereksekusi (30 tabel FORCE RLS, 124 policy) | `npm test -- tests/unit/migrations.test.ts` (PGlite) |
| 2 | PO dengan tagihan aktif tidak bisa dibatalkan | `npm test -- tests/unit/procurement.test.ts`; UAT: buat PO → catat PO_BILL → coba batal → 409 `PO_HAS_BILLS` |
| 3 | Pembuat invoice tidak bisa menyetujui sendiri | UAT: FINANCE buat invoice lalu Approve → 403 `SEPARATION_OF_DUTY`; user lain/ADMIN bisa |
| 4 | Ekspor fail-closed | login FIELD → `GET /api/export/invoices` → 403; `GET /api/export/expenses` → 200 |
| 5 | RAB internal tidak terekspor tanpa izin | login PROCUREMENT → `GET /api/export/budget` → hanya baris `CLIENT` |
| 6 | Notifikasi hanya milik sendiri | login 2 user berbeda → buka panel notifikasi → tidak ada notifikasi user lain |
| 7 | Tandai dibaca berfungsi | klik "Tandai semua dibaca" → badge hilang setelah refresh |
| 8 | Warning build `middleware` hilang | `env -u DATABASE_URL npm run build` → tanpa pesan deprecated |
| 9 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

Rincian: [`docs/modules/HARDENING-1.md`](../modules/HARDENING-1.md).

## Variabel environment

| Variabel | Wajib | Catatan |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled (`-pooler`) + `sslmode=require`. Pakai koneksi **transaction pooler** bila memakai Supabase. |
| `FILE_SIGNING_SECRET` | ✅ prod | ≥ 32 karakter; `openssl rand -hex 32`. Tanpa ini production gagal di request pertama. |
| `FILE_STORAGE_DRIVER` | ✅ prod S3 | `s3`; `local` ditolak di production karena filesystem Vercel ephemeral. |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ✅ prod S3 | Bucket privat S3-compatible; simpan hanya di environment Vercel. |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | ⛔ | Endpoint kustom Supabase/R2/MinIO; `true` bila provider butuh path-style. |
| `PG_POOL_MAX` | ⛔ | default 10; turunkan bila memakai pooler dengan batas koneksi ketat. |
| `SEED_DEMO_PASSWORD` | ⛔ | Jangan diset di production. |
| `ALLOW_DEMO_SEED` | ⛔ | `yes` hanya di environment uji. |
| `EPC_RLS_TEST` | ⛔ | `1` untuk menjalankan test integrasi RLS. |

## Catatan operasional & risiko sisa

- **Koneksi pool + `SET LOCAL`**: `withCompany()` membungkus tiap request dalam transaksi. Jangan menambah query di luar `companyRoute()`/`withCompany()` — RLS akan menolaknya (fail-closed).
- **`_migrations`** mencatat file yang sudah diterapkan; jangan mengedit file SQL yang sudah terpakai, buat file baru. `0002`, `0003`, `0004`, dan `0005` wajib dijalankan manual sebelum production karena Vercel tidak menjalankan migrasi dari runtime aplikasi.
- **S2a/S2b `app.current_permissions`**: script SQL manual yang tidak menyetel GUC ini akan melihat 0 baris RAB internal (fail-closed) dan tidak dapat meloloskan over-invoice (butuh `invoice.approve`).
- **`app.current_user_id` (0005)**: script SQL manual yang tidak menyetel GUC ini akan melihat 0 baris `notifications` (fail-closed). `withCompany()` sudah menyetelnya otomatis untuk seluruh route aplikasi.
- **Rekalkulasi termin** saat `IMPLEMENT` melewati termin yang sudah ditagihkan (tidak menurunkan nilai di bawah tagihan). S2b memakai `contract_terms.invoiced_amount` yang dijaga trigger sebagai sumber kumulatif; termin `INVOICED` / `CLOSED` atau `is_auto_amount=false` tidak diubah otomatis.
- **Keanggotaan proyek** (`project_members`) wajib ada untuk peran non-ADMIN; `npm run db:seed:demo` sudah mengisinya, produksi harus dipastikan manual.
- **Control-plane belum di-RLS** (`users`, `sessions`, `companies`, `memberships`, `invitations`, `auth_events`, katalog). Akses dijaga di aplikasi; pemisahan role DB direncanakan S2.
- **Token undangan** belum dikirim email — admin menyalin tautan manual. Integrasi email/SSO menyusul.
- **Rate limit login** berbasis tabel `auth_events`; belum ada lockout per akun/MFA.
- **`npm audit --omit=dev`** masih menyisakan 2 temuan *moderate* pada `exceljs`/`uuid` (tidak ada patch tanpa major downgrade). Risiko diterima sadar; dievaluasi saat sprint QA.
- **Signed URL file** tetap 5 menit. File lama dan PDF final masih memakai `base64` di DB (`storage_provider='DB'`); **foto lapangan baru** tersimpan di object `LOCAL`/`S3` dan DB hanya menyimpan metadata. Kredensial/bucket nyata tidak tersedia di sandbox, jadi smoke S3 produksi wajib dilakukan operator.
