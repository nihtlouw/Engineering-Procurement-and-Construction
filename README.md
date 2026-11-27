# Engineering, Procurement, and Construction (Ardaya EPC)

Aplikasi manajemen proyek EPC: proyek & klien, PO, RAB, biaya, tagihan, dokumen, jadwal, dan audit.
**Modular monolith**: Next.js 16 App Router · React 19 · TypeScript (strict) · Tailwind 4 · Drizzle ORM + `pg` → PostgreSQL (Neon/Supabase) · Zod · decimal.js · pdf-lib · exceljs. Deploy: Vercel.

> Baseline kondisi & roadmap: [`docs/AUDIT-EPC-2026-11-17.md`](docs/AUDIT-EPC-2026-11-17.md).
> Status saat ini: **S1 + S2a + S2b + S3 selesai + hardening-1** — fondasi company/RLS/Auth, RAB/PTK, PO/termin/CO, foto lapangan dalam PDF laporan, serta guard PO/invoice, isolasi notifikasi per pengguna, dan ekspor fail-closed. **S4 Document Generator penuh ditunda.**

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

## S2a — RAB, baseline, pagu & PTK

- Editor versi RAB (`CLIENT` / `INTERNAL`) dengan workflow `DRAFT → REVIEW → APPROVED → BASELINE`; baseline **terkunci & tunggal** (partial unique index).
- **Pagu per pos**: `pagu = total × (1 + kontingensi)`, warning >90%, blokir >100% kecuali alasan + izin `budget.approve`. Berlaku di `/api/expenses` dan `/api/purchases`; `budgetLineId` lintas proyek ditolak trigger DB.
- **PTK / Variation Order** `ADD` / `OMIT` / `SUBSTITUTE` dengan dampak harga, biaya, dan waktu **bertanda**; bisa dibatalkan sampai `APPROVED`; `IMPLEMENT` membuat revisi baseline, memperbarui jadwal, merekalkulasi termin, dan menulis audit diff per pos.
- **Satu sumber nilai kontrak**: `projects.contract_value_current` dijaga trigger DB; `finance.ts` tidak lagi menjumlah `change_orders`. CO lama tetap berfungsi lewat adapter yang sama.
- RAB internal hanya `ADMIN` / `PM` / `FINANCE`, ditegakkan policy RLS **`AS RESTRICTIVE`** + GUC `app.current_permissions`.
- Tab baru **RAB & PTK** di workspace proyek; panel lama tidak diubah.

Rincian desain, matriks peran, API, dan acceptance criteria: [`docs/modules/BUDGETING-PTK.md`](docs/modules/BUDGETING-PTK.md).

## S2b — PO berbasis pos, termin & CO lama

- `po_items` tertaut ke baseline RAB; PO lama di-backfill **non-destruktif** menjadi satu pos. Penerimaan barang dicatat per pos dengan `qty diterima ≤ qty pesan`.
- `PO_BILL` direkonsiliasi per pos terhadap nilai barang **yang sudah diterima**; baris tagihan wajib memilih pos PO bila PO memilikinya.
- `contract_terms.invoiced_amount` / `status` adalah satu sumber kumulatif tagihan, dijaga trigger DB (`OPEN → PARTIALLY_INVOICED → INVOICED`; `CLOSED` manual tidak ditimpa).
- Pagu **kumulatif per termin** dan **nilai kontrak berjalan** menolak double-invoice. Over-invoice hanya lolos dengan alasan ≥5 karakter **dan** izin `invoice.approve`; trigger DB fail-closed bila GUC permission kosong.
- CO lama tidak dihapus: dampak `ADD/OMIT/SUBSTITUTE` bertanda, bukti/referensi klien, pembatalan, dan implementasi tanpa hardcode `cat-civ`. Perubahan baru tetap direkomendasikan lewat PTK `variation_orders`.
- Tab baru **PO & Termin**; panel lama (Pengadaan, Tagihan, Change Order) tetap dipertahankan.

Rincian: [`docs/modules/PROCUREMENT-TERMIN-CO.md`](docs/modules/PROCUREMENT-TERMIN-CO.md).

## S3 — Foto lapangan masuk laporan dokumentasi

- Unggah `BEFORE` / `PROCESS` / `AFTER` maksimal **5 MB** lewat tab **Foto Lapangan**. MIME + magic bytes divalidasi, EXIF dirotasi, lalu `sharp` menormalkan ke JPEG; **bytes tidak disimpan sebagai base64 di DB**.
- Dev/test memakai storage `LOCAL`; production memakai bucket S3-compatible privat dengan presigned GET **5 menit**. Vercel filesystem ephemeral, jadi driver `local` ditolak di production.
- Filter tanggal inklusif, kategori, dan “hanya masuk laporan”. `CLIENT_VIEWER` hanya melihat foto yang diproyeksikan ke laporan; `FIELD` hanya unggah pada proyeknya sendiri.
- Saat generate `PROGRESS_REPORT`, BA/BAST, atau `CHANGE_ORDER`, foto terpilih disimpan sebagai snapshot `{{#photos}}` + `document_photo_links`; finalisasi menyematkan gambar ke PDF. Revisi tidak mengubah lampiran FINAL lama.
- Migrasi `0004_s3_field_photos.sql` menambah metadata storage, `field_photos`, `document_photo_links`, composite company FK, dan `FORCE RLS` (total **30 tabel / 122 policy**).

Rincian: [`docs/modules/FIELD-PHOTOS.md`](docs/modules/FIELD-PHOTOS.md).

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | TypeScript strict |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + eksekusi seluruh migrasi SQL di PGlite; integrasi RLS opsional) |
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
| `FILE_STORAGE_DRIVER` | ✅ production | `s3`; `local` hanya untuk dev/test |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ✅ production | Bucket privat S3-compatible; jangan commit kredensial |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | ⛔ | untuk Supabase/R2/MinIO |
| `PG_POOL_MAX` | ⛔ | default 10 |
| `SEED_DEMO_PASSWORD` | ⛔ | hanya untuk seed CLI |
| `ALLOW_DEMO_SEED` | ⛔ | `yes` hanya di environment uji |

**Jangan menyimpan secret di kode atau di repo.** `.env.*` sudah diabaikan Git kecuali `.env.example`.
Checklist deploy lengkap: [`docs/runbook/DEPLOY.md`](docs/runbook/DEPLOY.md).

## Struktur (S1)

```
src/
├── app/(app)/            # workspace (SSR) + loading/error boundaries
├── modules/budgeting/    # S2a: types, validation, pagu, service, UI
├── modules/procurement/  # S2b: types, validation, service, UI
├── modules/field-photos/ # S3: validation, filter, image, storage, service, UI
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
- `docs/modules/BUDGETING-PTK.md` — desain S2a.
- `docs/modules/PROCUREMENT-TERMIN-CO.md` — desain S2b, API, migrasi, dan acceptance criteria.
- `docs/modules/FIELD-PHOTOS.md` — desain S3, storage, `{{#photos}}`, keamanan, dan acceptance criteria.
- `docs/modules/HARDENING-1.md` — migrasi `0005`: guard PO, pemisahan tugas invoice, isolasi notifikasi, ekspor fail-closed.
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
