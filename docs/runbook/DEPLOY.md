# Runbook deploy — S1 / S2a / S2b / S3 / hardening-1 / master data

## Urutan (jangan dibalik)

1. **Backup** database produksi (snapshot + uji restore). Migrasi S1 menambah kolom `NOT NULL` + backfill; tidak ada down script.
2. Set environment di Vercel: `DATABASE_URL`, `FILE_SIGNING_SECRET` (≥ 32 char acak), dan untuk S3 `FILE_STORAGE_DRIVER=s3` + kredensial bucket privat. Pastikan `SEED_DEMO_PASSWORD` **tidak** diset di production.
3. Jalankan migrasi dari mesin yang punya akses DB (bukan dari Vercel runtime). Runner otomatis menerapkan `0000 → 0007`:
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

## Deploy master data (`0006_master_data_codes.sql`)

Migrasi **forward-only**, tanpa perubahan data: melepas UNIQUE global pada
`clients/opportunities/projects.code` lalu membuat UNIQUE `(company_id, code)`.
Backup tetap dianjurkan (DDL pada tabel inti).

| # | Kriteria master data | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0006 tereksekusi (30 tabel FORCE RLS, 124 policy, 3 index kode) | `npm test -- tests/unit/migrations.test.ts` |
| 2 | Dua company boleh memakai kode proyek sama; duplikat dalam company ditolak | test migrasi 0006 + UAT: buat `PRJ-2026-001` di company A lalu di company B |
| 3 | PM membuat proyek tanpa bantuan developer (< 15 menit) | UAT: menu **Master Data → Proyek baru** (3 langkah) |
| 4 | PM otomatis bisa membuka proyek yang dibuatnya | UAT: login PM, buka workspace proyek baru |
| 5 | Klien & site bisa dibuat dari wizard (quick create) | UAT: langkah 1 → "Klien baru cepat" + "Site baru cepat" |
| 6 | Anggota bisa ditambah/dikeluarkan; PM & anggota terakhir dilindungi | UAT tab **Anggota** |
| 7 | Klien dengan proyek tidak bisa diarsipkan | UAT tab **Klien → Arsip** → 409 `CLIENT_HAS_PROJECTS` |
| 8 | Field tanpa `schedule.edit` hanya bisa melihat | login FIELD → tombol tambah/ubah tidak muncul |
| 9 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

Rincian: [`docs/modules/MASTER-DATA.md`](../modules/MASTER-DATA.md).

## Deploy termin & katalog (`0007_terms_catalog.sql`)

Migrasi **forward-only** dan non-destruktif: menambah `contract_terms.notes`, satu
UNIQUE + satu index pada `contract_terms`, melepas UNIQUE global `cost_categories.code` /
`units.code` menjadi UNIQUE parsial `(company_id, code)`, serta menambah
`created_by_id`/`created_at` pada kedua tabel katalog. Tidak ada backfill data.
Backup tetap dianjurkan karena ada DDL pada tabel biaya.

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy aplikasi → smoke test tab **Master Data → Termin** dan **Katalog**.

| # | Kriteria termin & katalog | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0007 tereksekusi (30 tabel FORCE RLS, 124 policy, 6 index baru) | `npm test -- tests/unit/migrations.test.ts` |
| 2 | Urutan termin unik per proyek; proyek lain boleh memakai urutan sama | test migrasi 0007 |
| 3 | Komposisi persen harus 100% (±0,01); campuran persen & nominal diizinkan | `npm test -- tests/unit/terms-catalog.test.ts` |
| 4 | PM (tanpa `invoice.edit`) tetap bisa menyusun termin; FIELD tidak | UAT: login PM → tab Termin bisa disimpan; login FIELD → read-only |
| 5 | Termin yang sudah ditagihkan tidak bisa dihapus (`TERM_HAS_INVOICES`) & tidak bisa turun di bawah tagihan (`TERM_BELOW_INVOICED`) | UAT: buat invoice dari termin → coba hapus baris di tab Termin |
| 6 | Maksimal satu termin RETENTION per proyek | UAT: tambah dua baris RETENTION → 422 `RETENTION_DUPLICATE` |
| 7 | Status CLOSED tidak kembali OPEN saat nominal diubah | test migrasi 0007 + UAT tombol **Tutup** (alasan wajib ≥ 5 karakter) |
| 8 | Kode kategori/satuan unik per company; katalog bersama (`company_id NULL`) read-only | UAT: buat kategori `MAT` di company A dan B; coba ubah baris bersama → 409 `SHARED_CATALOG_READONLY` |
| 9 | Kode kategori terkunci bila sudah dipakai RAB; kode satuan selalu terkunci | UAT: ubah kode kategori yang dipakai pos RAB → 409 `CATEGORY_IN_USE` |
| 10 | Field/procurement tidak bisa melihat termin proyek yang bukan miliknya | login FIELD → tab Termin hanya proyek yang diikuti (`requireProject`) |
| 11 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

Rincian: [`docs/modules/TERMS-CATALOG.md`](../modules/TERMS-CATALOG.md).

## Deploy Document Generator (`0008_document_templates.sql`)

Migrasi **forward-only**, menambah 3 tabel template dan 6 kolom pada `documents`
(`template_code` menjadi nullable). Backup dianjurkan (DDL pada tabel dokumen).

Prasyarat baru: `docxtemplater` + `pizzip` (murni JS, ikut bundle serverless; tidak
butuh Chromium/LibreOffice). Object storage (`FILE_STORAGE_DRIVER=s3`) sudah wajib
sejak S3 — PDF dan DOCX hasil finalisasi ditulis ke sana, bukan ke database.

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy → smoke test tab **Dokumen → Template**.

| # | Kriteria S4 | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0008 tereksekusi (33 tabel FORCE RLS, 132 policy, 11 template sistem) | `npm test -- tests/unit/migrations.test.ts` (43 test) |
| 2 | Template bisa diubah admin tanpa deploy | UAT: **Dokumen → Template → Duplikat & ubah** → ubah judul blok → generate dokumen baru memakai versi baru |
| 3 | Dokumen lama tidak berubah saat template diubah | UAT: dokumen FINAL sebelum perubahan tetap sama; `template_snapshot` menyimpan salinan |
| 4 | Upload `.docx` dengan `{projectCode}` terisi | UAT: unggah .docx → variabel terbaca → generate → finalisasi → unduh DOCX berisi nilai proyek |
| 5 | PDF + DOCX tersimpan di object storage (bukan base64 DB) | setelah finalisasi: `select storage_provider, content_base64 from file_objects order by created_at desc limit 2` → provider S3/LOCAL, base64 NULL |
| 6 | FINAL immutable; revisi membuat versi baru | UAT: edit blok ditolak pada FINAL (409 `DOCUMENT_LOCKED`), **Buat revisi** menghasilkan r+1 dan dokumen lama `SUPERSEDED` |
| 7 | Arsip mencatat alasan, berkas tetap ada | UAT: **Arsipkan** → status `ARCHIVED`, `archive_reason` terisi, PDF/DOCX masih bisa diunduh |
| 8 | Template sistem read-only; varian company terisolasi | UAT: company B tidak melihat template company A; ubah template sistem → 409 `SHARED_CATALOG_READONLY` |
| 9 | Editor blok visual menggantikan JSON mentah | UAT: **Edit blok** → tambah tabel/tanda tangan → simpan → preview & PDF sesuai |
| 10 | Dokumen unggahan tanpa template tetap valid | UAT: **Unggah** PDF/DOCX → muncul di papan dengan `template_code` kosong |
| 11 | Hanya `template.manage` yang bisa mengunggah template | login PM → tombol template admin tidak muncul; API upload → 403 |
| 12 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

Rincian: [`docs/modules/DOCUMENT-GENERATOR.md`](../modules/DOCUMENT-GENERATOR.md).

## Deploy WBS & kurva-S (`0009_wbs_scurve.sql`)

Migrasi **forward-only** pada tabel jadwal yang sudah berisi data: 6 kolom baru di
`schedule_items` + backfill, 1 tabel baru `project_wbs_calendars`, dan 2 FK parsial
dari RAB ke WBS. Semua langkah idempoten (`IF NOT EXISTS`, `DO $$ ... $$`) sehingga
aman diulang bila render Neon memutus koneksi.

**Backup wajib** sebelum menjalankan: `pg_dump --schema=public` ke object storage.
Backfill menulis `code`, `level`, dan `planned_pct_per_period` pada baris lama;
DB dengan item jadwal dalam jumlah besar akan menahan lock tulis singkat.

Urutan: backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy → smoke test tab **Jadwal & Progres**.

| # | Kriteria S5 | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0009 tereksekusi (34 tabel FORCE RLS, 136 policy) | `npx vitest run tests/unit/migrations.test.ts` (49 test) |
| 2 | `db:verify` melaporkan 3 pemeriksaan 0009 lulus | `npm run db:verify` → “0009 kolom WBS”, “0009 kalender WBS terisolasi”, “0009 backfill WBS” PASS |
| 3 | Semua item jadwal lama punya kode & level | `select count(*) from schedule_items where code is null or level is null` → 0 |
| 4 | Σ bobot ≠ 100% ditolak | UAT: ubah satu bobot → Simpan → 422 `WBS_WEIGHT_TOTAL`; centang draft (`allowIncomplete`) → tersimpan tapi pita Σ berwarna merah |
| 5 | Kode WBS unik per proyek | UAT: tambah item baru → kode `WBS-002` otomatis; dua proyek berbeda boleh sama-sama `WBS-001` |
| 6 | Hapus induk menghapus turunannya dan tercatat di audit | UAT: hapus grup berisi 2 aktivitas → hitung ulang item; log `WBS_SAVED` memuat `removed: 3` |
| 7 | Kurva-S rencana berakhir 100% dan aktual berhenti di laporan terakhir | UAT: isi tanggal rencana 4 minggu → kurva naik ke 100%; catat progres 2 minggu → minggu ke-3/4 kosong, bukan 0 |
| 8 | Penguncian kalender menuntut alasan dan bobot 100% | UAT: **Kunci kalender** dengan alasan 3 karakter → tombol nonaktif; API → 422; alasan ≥5 karakter → status LOCKED + audit `CALENDAR_LOCKED` |
| 9 | Setelah LOCK, non-ADMIN tidak bisa mengubah WBS | UAT: login PM → editor baca-saja; kirim `PUT /wbs` → 409/403 |
| 10 | Proyek COMPLETED hanya bisa diubah ADMIN | UAT: proyek berstatus COMPLETED → `PUT /wbs` sebagai PM → 409 `PROJECT_LOCKED` |
| 11 | Peran tanpa `schedule.edit` tidak bisa menyimpan | UAT: login FIELD/CLIENT_VIEWER → panel read-only, API → 403 `FORBIDDEN` |
| 12 | Tautan RAB → WBS menolak ID lintas proyek | UAT: `POST /wbs/action` `LINK_BUDGET_LINE` dengan baris RAB proyek lain → 404 `WBS_ITEM_NOT_FOUND`/`NOT_FOUND` |
| 13 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

Rincian: [`docs/modules/WBS-SCURVE.md`](../modules/WBS-SCURVE.md).

## Deploy Hardening-2 (`0010_login_lockout.sql`) + perubahan jalur file

Migrasi **forward-only** menambah 2 kolom pada `users` (nullable/default, tanpa
backfill) dan 1 index parsial. Aman dijalankan tanpa downtime berarti; tidak ada
penulisan massal ke tabel besar.

**Perubahan perilaku yang harus disosialisasikan sebelum deploy:**

| Perubahan | Dampak operasional |
|---|---|
| Batas unggah berkas generik **25 MB → 10 MB** | Nota/foto >10 MB ditolak 413. Klien mengompresi bertahap, tetapi pengguna perlu tahu batas barunya. |
| Nota baru disimpan di object storage (`content_base64` NULL) | `FILE_STORAGE_DRIVER=s3` wajib di production (sudah wajib sejak S3). Tanpa S3, unggahan gagal 500 `STORAGE_CONFIG`. |
| Berkas lama berprovider `DB` tetap terbaca | `getObjectBuffer()` memakai jalur dual-read; **tidak ada backfill yang diperlukan**, tetapi blob lama masih menempati DB. Pembersihan opsional di luar rilis ini. |
| Tipe berkas ditentukan dari isi | Berkas yang selama ini lolos karena MIME salah (mis. `.dwg` dikirim sebagai `image/png`) sekarang ditolak 415. DWG tidak lagi diterima karena isinya tidak dapat diverifikasi. |
| Akun terkunci setelah 10/20 kegagalan | Dukungan pengguna perlu tahu tombol **Pengguna & peran → Buka kunci** dan kode `423 ACCOUNT_LOCKED`. |
| Tautan nota tidak lagi dikirim ke semua pemegang `expense.view.project` | Peran yang sebelumnya dapat mengklik nota orang lain akan melihat nota tanpa tautan. Ini disengaja (audit #3). |

Urutan: `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` → deploy → smoke test login & unggah nota.

| # | Kriteria Hardening-2 | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0010 tereksekusi (34 tabel FORCE RLS, 136 policy) | `npx vitest run tests/unit/migrations.test.ts` (52 test) |
| 2 | `db:verify` melaporkan 3 pemeriksaan 0010 | `npm run db:verify` → “0010 kolom kunci login”, “0010 index akun terkunci”, “0010 CHECK penghitung” PASS |
| 3 | Unggah dengan MIME palsu ditolak | UAT: kirim teks sebagai `image/png` ke `POST /api/files` → 415 `MAGIC_BYTES_INVALID` / `MIME_MISMATCH` |
| 4 | Berkas baru tidak lagi disimpan di DB | setelah unggah: `select storage_provider, content_base64 from file_objects order by created_at desc limit 1` → provider `S3`, base64 NULL |
| 5 | Berkas lama (provider DB) masih dapat dibuka | UAT: buka nota lama dari detail pengeluaran → gambar tampil |
| 6 | Berkas non-gambar dipaksa unduh | UAT: buka PDF/DOCX → `Content-Disposition: attachment`, header CSP `sandbox` ada |
| 7 | Tautan nota hanya untuk pihak berhak | UAT: login FIELD lain pada proyek yang sama → nota terlihat, tombol “Buka bukti nota” tidak ada |
| 8 | 10 kegagalan mengunci akun 15 menit | UAT: salah password 10× → respons ke-11 `423 ACCOUNT_LOCKED` (+ audit `ACCOUNT_LOCKED`) |
| 9 | Login berhasil mereset penghitung | UAT: buka kunci/lalu login benar → `failed_login_count = 0`, `locked_until` NULL |
| 10 | ADMIN dapat membuka kunci | UAT: **Pengguna & peran → Buka kunci** → badge “Terkunci” hilang, audit `LOGIN_UNLOCKED` muncul |
| 11 | Ekspor jadwal mengikuti izin & memuat Σ bobot | UAT: `/api/export/schedule` sebagai FIELD → 403; sebagai PM → XLSX berisi baris “Σ bobot …” |
| 12 | Progres pada baris ringkasan WBS ditolak | UAT: `POST /api/schedule/<id-grup>/progress` → 422 `WBS_SUMMARY_READONLY` |
| 13 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

## Pemulihan akses (lupa password)

Password disimpan sebagai hash **scrypt** — tidak dapat dilihat atau
"diingat kembali" oleh siapa pun, termasuk developer. Ada tiga jalur pemulihan,
urutkan dari yang paling ringan:

| Situasi | Jalur | Siapa |
|---|---|---|
| Pengguna masih bisa masuk | **Pengaturan → Password akun → Ganti password** (wajib password lama) | pengguna sendiri |
| Pengguna lupa password, ada ADMIN lain yang bisa masuk | **Pengguna & peran → Reset password** pada baris anggota | ADMIN company |
| Tidak ada satu pun ADMIN yang bisa masuk | `npm run db:reset-password -- --email <email>` | pemegang akses environment |

### Reset lewat UI (ADMIN)

1. Buka **Pengguna & peran**, cari anggota, klik **Reset password**.
2. Buat password baru (min. 12 karakter, huruf besar + kecil + angka).
3. Password baru ditampilkan **sekali** — serahkan lewat kanal aman (bukan chat grup).
4. Efek samping otomatis: semua sesi anggota tersebut dicabut, kunci login dibuka, audit `PASSWORD_RESET` tercatat. Nilai password di audit ditulis `[redacted]`.
5. Minta pengguna segera mengganti lewat **Pengaturan → Password akun**.

### Tanpa terminal sama sekali (paling cepat)

Kalau Anda sedang membuka dashboard Neon dan tidak ingin menyentuh terminal,
Anda tetap butuh **hash** — hash tidak bisa dibuat oleh Postgres (aplikasi
memakai scrypt Node, bukan `pgcrypto`). Dua cara mendapatkan hash tanpa
terminal:

1. minta rekan/CI menjalankan `npm run db:hash-password -- --password '...' --email <email>`
   lalu kirimkan hash-nya; atau
2. gunakan hash yang sudah dibuat dan diverifikasi sebelumnya (catat di tempat
   aman, lalu **segera ganti password** setelah berhasil masuk).

Setelah hash tersedia, tempel SQL berikut di **Neon → SQL Editor** (bukan
perintah `npm`, itu untuk terminal):

```sql
begin;

-- Ganti hash di bawah dengan hash 161 karakter milik Anda.
update users
   set password_hash = '<HASH_161_KARAKTER>',
       failed_login_count = 0,   -- hapus dua baris ini bila migrasi 0010 belum dijalankan
       locked_until = null
 where email = 'admin@ardaya.id';

delete from sessions
 where user_id = (select id from users where email = 'admin@ardaya.id');

commit;
```

Periksa hasilnya (harus `161`):

```sql
select email, length(password_hash) as panjang, failed_login_count, locked_until
  from users where email = 'admin@ardaya.id';
```

Bila `failed_login_count` / `locked_until` belum ada, artinya migrasi `0010`
belum diterapkan — jalankan dulu `npm run db:migrate`, atau pakai varian minimal:

```sql
begin;
update users set password_hash = '<HASH_161_KARAKTER>' where email = 'admin@ardaya.id';
delete from sessions where user_id = (select id from users where email = 'admin@ardaya.id');
commit;
```

> **Kesalahan yang sering terjadi:** menempel `npm run db:hash-password …` ke
> SQL Editor Neon → `ERROR: syntax error at or near "npm" (SQLSTATE 42601)`.
> Neon hanya menjalankan SQL; `npm run …` dijalankan di terminal pada folder repo.

### Lewat table editor / SQL editor Neon

Cara paling cepat bila Anda sudah membuka dashboard Neon — tetapi **jangan
mengetik password** ke kolom `password_hash`. Kolom itu berisi `salt:hash`
scrypt 161 karakter; teks biasa tidak akan pernah cocok dan akun jadi mustahil
login. Buat hash-nya dulu:

```bash
npm run db:hash-password -- --password 'Ard4yaPemulihan26' --email admin@ardaya.id
```

Perintah di atas mencetak hash **dan** blok SQL siap tempel (satu transaksi,
sekalian mereset penghitung, membuka kunci, dan mencabut sesi). Bila ingin
lewat **table editor** alih-alih SQL editor: salin hash, lalu pada baris akun
ubah tiga kolom berikut dalam satu kali simpan:

| Kolom | Nilai |
|---|---|
| `password_hash` | hash hasil perintah di atas (tempel, jangan diketik) |
| `failed_login_count` | `0` |
| `locked_until` | `NULL` (kosongkan) |

Setelah menyimpan dari table editor, **hapus baris di tabel `sessions`** milik
user tersebut (atau jalankan `delete from sessions where user_id = '<id>'`),
supaya sesi lama tidak tetap hidup.

> Hash lama di screenshot Anda terlihat identik untuk enam akun karena seed demo
> memakai satu password yang sama untuk semua akun — itu normal, bukan bug.
> Kalau Anda mengubahnya satu per satu di table editor, gunakan hash **berbeda**
> per akun (jalankan CLI sekali per akun) agar satu kebocoran tidak membuka semua akun.

### Reset lewat CLI (tidak ada ADMIN yang bisa masuk)

```bash
# password acak 20 karakter, ditampilkan sekali
npm run db:reset-password -- --email admin@ardaya.id

# atau tentukan sendiri (min. 12 karakter, huruf besar+kecil+angka)
npm run db:reset-password -- --email admin@ardaya.id --password 'Ard4yaPemulihan26'
```

Skrip ini mencabut semua sesi akun, membuka kunci login, dan menulis audit
`PASSWORD_RESET_CLI`. Skrip **tidak** diblokir di production (berbeda dari seed
demo) karena inilah jalur pemulihan darurat yang sah; syaratnya tetap harus
memegang `DATABASE_URL`.

> **Kenapa tidak ada tautan "lupa password" lewat email?** Aplikasi belum punya
> pengiriman email dan belum punya verifikasi identitas lain (OTP/pertanyaan
> keamanan). Tanpa verifikasi, tautan reset berbasis email hanya memindahkan
> risiko: siapa pun yang bisa membaca kotak masuk, atau yang tahu email, bisa
> mengambil alih akun. Menambahkannya bersamaan dengan penyedia email (S6+)
> adalah urutan yang benar.

### Akun terkunci karena salah password

Terkunci otomatis 15 menit setelah 10 kegagalan (60 menit setelah 20). ADMIN
cukup menekan **Buka kunci** pada baris anggota — atau reset password, yang juga
membuka kunci. Admin sendiri yang lupa password harus memakai jalur CLI.

## Deploy reset password lewat email (`0011_password_reset_tokens.sql`)

Migrasi menambah **satu tabel baru** `password_reset_tokens` (tanpa RLS, seperti
`invitations`) dan dua index. Tidak ada perubahan pada tabel yang sudah berisi
data, jadi tidak butuh backup khusus.

Fitur ini menutup kekurangan S1: sebelumnya pemulihan password hanya mungkin
bila ada ADMIN yang mengetik password baru untuk orang lain — artinya password
selalu berpindah tangan dalam bentuk terbaca.

| # | Kriteria | Cara |
|---|---|---|
| 1 | Rangkaian 0000–0011 tereksekusi | `npx vitest run tests/unit/migrations.test.ts` (55 test) |
| 2 | `db:verify` melaporkan pemeriksaan 0011 | `npm run db:verify` → “0011 tabel token reset” PASS |
| 3 | Tautan “Lupa password” muncul di halaman masuk | buka `/` → klik **Lupa password?** |
| 4 | Permintaan email tak terdaftar tidak membocorkan apa pun | kirim `POST /api/auth/forgot-password` dengan email acak → respons sama, tidak ada email terkirim |
| 5 | Token sekali pakai | buka tautan → isi password → buka tautan yang sama lagi → 409 `RESET_TOKEN_USED` |
| 6 | Tautan kedaluwarsa 30 menit | `PASSWORD_RESET_TTL_MINUTES=5`, minta tautan, tunggu 6 menit → 410 `RESET_TOKEN_EXPIRED` |
| 7 | Permintaan baru membatalkan tautan lama | minta dua kali, pakai tautan pertama → 409 `RESET_TOKEN_REVOKED` |
| 8 | Semua sesi dicabut setelah reset | login di dua peramban → reset → peramban lain terlempar ke halaman masuk |
| 9 | Hanya hash token yang disimpan | `select token_hash from password_reset_tokens order by created_at desc limit 1` → 64 karakter hex, bukan token asli |
| 10 | Batas 3 permintaan/jam per akun & 10/jam per IP | ulangi permintaan → respons tetap generik, `auth_events` mencatat `RATE_LIMITED` |
| 11 | ADMIN dapat mengirim tautan tanpa tahu password | **Pengguna & peran → Kirim tautan** → email masuk, UI tidak menampilkan password |
| 12 | Undangan kini terkirim lewat email | undang anggota → email berisi tautan `/accept-invite?token=…` |
| 13 | Password berubah lewat jalur lain mencabut tautan email | buat tautan, lalu ADMIN reset manual → tautan lama 409 `RESET_TOKEN_REVOKED` |
| 14 | Build/typecheck/lint/test/audit hijau | `npm run typecheck && npm run lint && npm test && npm audit --omit=dev --audit-level=high` |

**Prasyarat email di production:** `EMAIL_DRIVER=resend`, `RESEND_API_KEY`,
`EMAIL_FROM` (domain terverifikasi), `APP_BASE_URL`. Tanpa `APP_BASE_URL`,
aplikasi menolak membuat tautan (bukan mengirim tautan rusak) dan UI memberi tahu
admin. Tanpa `EMAIL_DRIVER`, UI menampilkan pesan “email belum dikonfigurasi” dan
admin tetap bisa memakai **Reset manual**.

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
| `EMAIL_DRIVER` | ⛔ | `resend` (production), `console` (dev: isi email dicetak ke log, tidak dikirim), `none` (default). |
| `RESEND_API_KEY` | ⛔ | Wajib bila `EMAIL_DRIVER=resend`. Buat di dashboard Resend. |
| `EMAIL_FROM` | ⛔ | Pengirim, mis. `Ardaya EPC <no-reply@domain-anda.id>`. Domain harus terverifikasi di penyedia. |
| `APP_BASE_URL` | ⛔ | Basis tautan email, mis. `https://epc.domain-anda.id`. Tanpa ini tautan reset/undangan tidak dibuat di production. |
| `PASSWORD_RESET_TTL_MINUTES` | ⛔ | Masa berlaku tautan reset, default 30 (batas wajar 5–240). |

## Catatan operasional & risiko sisa

- **Koneksi pool + `SET LOCAL`**: `withCompany()` membungkus tiap request dalam transaksi. Jangan menambah query di luar `companyRoute()`/`withCompany()` — RLS akan menolaknya (fail-closed).
- **`_migrations`** mencatat file yang sudah diterapkan; jangan mengedit file SQL yang sudah terpakai, buat file baru. `0002`–`0008` wajib dijalankan manual sebelum production karena Vercel tidak menjalankan migrasi dari runtime aplikasi.
- **S2a/S2b `app.current_permissions`**: script SQL manual yang tidak menyetel GUC ini akan melihat 0 baris RAB internal (fail-closed) dan tidak dapat meloloskan over-invoice (butuh `invoice.approve`).
- **`app.current_user_id` (0005)**: script SQL manual yang tidak menyetel GUC ini akan melihat 0 baris `notifications` (fail-closed). `withCompany()` sudah menyetelnya otomatis untuk seluruh route aplikasi.
- **Rekalkulasi termin** saat `IMPLEMENT` melewati termin yang sudah ditagihkan (tidak menurunkan nilai di bawah tagihan). S2b memakai `contract_terms.invoiced_amount` yang dijaga trigger sebagai sumber kumulatif; termin `INVOICED` / `CLOSED` atau `is_auto_amount=false` tidak diubah otomatis.
- **Keanggotaan proyek** (`project_members`) wajib ada untuk peran non-ADMIN; `npm run db:seed:demo` sudah mengisinya, produksi harus dipastikan manual.
- **Control-plane belum di-RLS** (`users`, `sessions`, `companies`, `memberships`, `invitations`, `auth_events`, katalog). Akses dijaga di aplikasi; pemisahan role DB direncanakan S2. Untuk katalog, `listCatalog()` memfilter `company_id IS NULL OR company_id = <company aktif>` secara eksplisit.
- **Katalog bersama (`company_id IS NULL`)** adalah warisan pra-S1 dan **read-only** di UI/API (409 `SHARED_CATALOG_READONLY`). Company yang butuh variasi membuat baris sendiri dengan kode berbeda.
- **Urutan termin** dijaga UNIQUE `(company_id, project_id, sort_order)`; penyimpanan replace-by-set menggeser baris lama ke slot sementara dalam satu transaksi, jadi jangan menulis `contract_terms.sort_order` manual di luar `saveContractTerms()`.
- **Token undangan** belum dikirim email — admin menyalin tautan manual. Integrasi email/SSO menyusul.
- **Rate limit login** berbasis tabel `auth_events`; belum ada lockout per akun/MFA.
- **`npm audit --omit=dev`** masih menyisakan 2 temuan *moderate* pada `exceljs`/`uuid` (tidak ada patch tanpa major downgrade). Risiko diterima sadar; dievaluasi saat sprint QA.
- **Signed URL file** tetap 5 menit. File lama dan PDF final masih memakai `base64` di DB (`storage_provider='DB'`); **foto lapangan baru** tersimpan di object `LOCAL`/`S3` dan DB hanya menyimpan metadata. Kredensial/bucket nyata tidak tersedia di sandbox, jadi smoke S3 produksi wajib dilakukan operator.
