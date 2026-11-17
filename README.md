# Engineering, Procurement, and Construction (Ardaya EPC)

Aplikasi manajemen proyek EPC: proyek & klien, PO, RAB, biaya, tagihan, dokumen, jadwal, dan audit.
**Modular monolith**: Next.js 16 App Router · React 19 · TypeScript (strict) · Tailwind 4 · Drizzle ORM + `pg` → PostgreSQL (Neon/Supabase) · Zod · decimal.js · pdf-lib · exceljs. Deploy: Vercel.

> Baseline kondisi & roadmap: [`docs/AUDIT-EPC-2026-11-17.md`](docs/AUDIT-EPC-2026-11-17.md).
> Status saat ini: **S1 selesai** — fondasi company/RLS/Auth & RBAC. Modul lain menyusul per sprint.

## Setup lokal

```bash
npm ci
cp .env.example .env.local     # isi DATABASE_URL (dan FILE_SIGNING_SECRET)
npm run db:migrate             # terapkan migrasi SQL berversi
npm run db:verify              # opsional: uji isolasi RLS (butuh DB)
npm run dev
```

**Jangan** memakai `npx drizzle-kit push` untuk mengubah skema pada environment bersama. Semua perubahan skema lewat file `drizzle/NNNN_*.sql` + `npm run db:migrate` (lihat [`drizzle/README.md`](drizzle/README.md)).

### Data demo (opsional, hanya CLI)

```bash
SEED_DEMO_PASSWORD='password-anda' npm run db:seed:demo
```

Seed **tidak pernah** dijalankan dari HTTP request dan diblokir di production kecuali `ALLOW_DEMO_SEED=yes`. Tidak ada password bawaan di kode dan tidak ada kredensial demo yang ditampilkan di halaman login.

## Isolasi data per company (S1)

- `companies` + `memberships` (role otoritatif per company) + `invitations` (token hanya disimpan sebagai hash).
- `company_id` di 24 tabel bisnis, di-backfill ke satu company **tanpa menghapus data existing**.
- **RLS `ENABLE` + `FORCE`** dengan policy `company_id = app_current_company_id()`.
- `withCompany()` menjalankan satu transaksi per request dengan `SET LOCAL app.current_company_id`; `db` adalah proxy yang otomatis memakai transaksi berskope tersebut.
- Tanpa scope → 0 baris / insert ditolak (**fail-closed**).
- Peran: `ADMIN`, `ESTIMATOR`, `PM`, `FIELD`, `PROCUREMENT`, `FINANCE`, **`CLIENT_VIEWER`** (read-only, tanpa RAB internal).
- Sesi 12 jam absolut / 30 menit idle, rotasi saat login, rate limit login berbasis tabel (bukan in-memory), CSRF/Origin guard, security headers, audit log append-only via trigger DB.

Verifikasi: `npm test` menjalankan uji SQL migrasi + isolasi RLS memakai Postgres in-process (PGlite, tanpa server eksternal). Untuk database nyata: `npm run db:migrate -- --check`, `npm run db:migrate`, lalu `npm run db:verify` (atau `EPC_RLS_TEST=1 npm test`).

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit; integrasi RLS opsional) |
| `npm run db:migrate` | Terapkan migrasi berversi |
| `npm run db:migrate -- --check` | Daftar migrasi tertunda |
| `npm run db:verify` | Uji isolasi RLS + audit append-only |
| `npm run db:seed:demo` | Seed demo via CLI |

`npm run build` **sengaja harus lulus tanpa `DATABASE_URL`** (konfigurasi divalidasi pada request pertama, bukan saat build).

## Environment (Vercel)

| Variabel | Wajib | Catatan |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled connection string + `sslmode=require` |
| `FILE_SIGNING_SECRET` | ✅ production | ≥ 32 karakter acak; `openssl rand -hex 32` |
| `PG_POOL_MAX` | ⛔ | default 10 |
| `SEED_DEMO_PASSWORD` | ⛔ | hanya untuk seed CLI |
| `ALLOW_DEMO_SEED` | ⛔ | `yes` hanya di environment uji |

**Jangan menyimpan secret di kode atau di repo.** `.env.*` sudah diabaikan Git kecuali `.env.example`.
Checklist deploy lengkap: [`docs/runbook/DEPLOY.md`](docs/runbook/DEPLOY.md).

## Struktur (S1)

```
src/
├── app/(app)/            # workspace (SSR) + loading/error boundaries
├── app/api/              # route handler, dibungkus companyRoute()/publicRoute()
├── app/accept-invite/    # halaman penerimaan undangan
├── modules/companies/    # modul pertama: types, validation, service, ui
├── shared/               # auth/route, db/context, env
├── db/                   # pool lazy + Proxy + schema Drizzle
├── lib/                  # auth, domain, finance, workspace, pdf, format, ...
└── middleware.ts         # guard tepi (cookie + Origin/Sec-Fetch-Site)
drizzle/                  # migrasi SQL berversi
scripts/                  # migrate, verify-rls, seed-demo
tests/                    # unit + integrasi
```

## Dokumentasi

- `docs/AUDIT-EPC-2026-11-17.md` — audit, 10 masalah, arsitektur, roadmap, addendum budgeting/PTK.
- `docs/TUTORIAL-DAN-UJI-SCOPE.md` — tutorial & skenario uji (sebagian mengacu UI pra-S1).
- `docs/RINGKASAN-DESAIN-UI.md` — keputusan desain antarmuka.
- `public/docs/Panduan-Ardaya-EPC.pdf` — panduan pemakaian (21 halaman, bahasa Indonesia).
- `analisis/`, `design/` — arsip analisis & papan konsep lama (**superseded** oleh audit di atas).

### Membangun ulang PDF panduan

Isi panduan ada di `tools/docs-content.mjs`; tata letak memakai `pdf-lib`.

```bash
npm install --no-save @pdf-lib/fontkit wawoff2 @fontsource/instrument-sans
node tools/build-docs-pdf.mjs
```

### Konsep desain v2 (belum diterapkan)

`design/v2/index.html` adalah papan konsep statis. `node design/v2/build.mjs` merakit ulang dari `part*.html`.
