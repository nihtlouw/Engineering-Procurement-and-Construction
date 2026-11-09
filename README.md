# Engineering, Procurement, and Construction

Next.js EPC contractor management application using Drizzle ORM and PostgreSQL.

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon connection string. Keep `.env.local` out of Git.

3. Push the schema to the configured database:

   ```bash
   npx drizzle-kit push
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

The app seeds demo data when the database is empty. Set `SEED_DEMO_PASSWORD` before the first run if you want a custom demo password.

## Neon deployment variables

Configure these environment variables in the hosting provider:

- `DATABASE_URL`: Neon pooled connection string, including `sslmode=require`.
- `FILE_SIGNING_SECRET`: long random secret used to sign file access.
- `SEED_DEMO_PASSWORD`: optional initial demo password.

Never commit `.env.local` or any Neon password to the repository.

## Dokumentasi

- `docs/TUTORIAL-DAN-UJI-SCOPE.md` — cakupan tutorial dan skenario uji.
- `docs/RINGKASAN-DESAIN-UI.md` — ringkasan keputusan desain antarmuka.
- `public/docs/Panduan-Ardaya-EPC.pdf` — panduan pemakaian lengkap (21 halaman, bahasa Indonesia).

### Membangun ulang PDF panduan

Isi panduan berada di `tools/docs-content.mjs`; tata letak PDF dikendalikan `tools/build-docs-pdf.mjs` memakai `pdf-lib` (tanpa Chromium atau pandoc). Alat bantu ini memerlukan tiga paket tambahan yang tidak dipakai aplikasi saat berjalan:

```bash
npm install --no-save @pdf-lib/fontkit wawoff2 @fontsource/instrument-sans
node tools/build-docs-pdf.mjs
```

Pasang ketiganya dalam satu perintah: `npm install --no-save` akan melepas paket `--no-save` lain yang tidak disebut pada perintah yang sama.

## Konsep desain v2 (belum diterapkan)

`design/v2/index.html` adalah papan konsep untuk arah desain berikutnya: seluruh halaman aplikasi dalam satu berkas statis, tanpa JavaScript dan tanpa server — cukup dibuka di peramban.

```bash
node design/v2/build.mjs   # rakit ulang index.html dari part*.html
```

Isi `design/v2/`: `part1..part5.html` (potongan papan), `concept.css` (token dan komponen v2), `build.mjs` (perakit + penyuntik kerangka rail/topbar/tab). Belum ada berkas di `src/` yang diubah.
