# S3 — Foto Lapangan masuk Laporan Dokumentasi

## Status & batas ruang lingkup

S3 adalah **satu vertical slice**: unggah → galeri/filter → foto terpilih tampil di PDF laporan. **S4 Document Generator penuh tetap ditunda.** Kontrak `{{#photos}}` yang dipakai modul ini sengaja minimal: snapshot dokumen menyimpan array referensi foto, bukan template language lengkap.

| Acceptance | Implementasi |
|---|---|
| Unggah 5 MB tersimpan di storage, DB hanya metadata | `POST /api/field-photos` multipart; validasi 5 MB, MIME + magic bytes; `sharp` rotasi EXIF/normalisasi JPEG; `file_objects.content_base64 = NULL`, `storage_provider = LOCAL/S3` |
| Foto `BEFORE` / `PROCESS` / `AFTER` tampil di laporan | tab **Foto Lapangan** → toggle **Masuk laporan** → `document_photo_links` → blok `photoGallery` pada `PROGRESS_REPORT`, BA/BAST, dan `CHANGE_ORDER` → `pdf-lib.embedJpg()` |
| Filter tanggal benar | `filterFieldPhotos()` dipakai UI dan `GET /api/field-photos`; `from`/`to` inklusif pada `captured_at` (DATE), diuji unit + PGlite |

## Arsitektur

```
browser ── multipart/form-data ──> /api/field-photos
                                   │ companyRoute() → SET LOCAL company + permissions
                                   │ requireProject(user, projectId, document.upload)
                                   │ validatePhotoBuffer() → sharp.compressPhoto()
                                   ├──> LOCAL (dev/test): .local-storage/private/...
                                   └──> S3  (prod): PutObjectCommand, private bucket
                                   │
                                   └──> DB: file_objects(metadata) + field_photos + activity_logs

generate PROGRESS_REPORT/BA/BAST/CHANGE_ORDER
  → getSelectedPhotoRefs(projectId)
  → merge_snapshot["{{#photos}}"] = JSON refs (tanpa URL kedaluwarsa)
  → blocks photoGallery + document_photo_links (immutable per revisi)

FINALIZE
  → getDocumentPhotoBundle(documentId)
  → withPhotoRefs(blocks, refs dari link-table)
  → renderDocumentPdf(..., { photoSources: file_id → StoredFile })
  → embedJpg(getObjectBuffer(source))
  → PDF final disimpan seperti alur dokumen lama
```

`document_photo_links` adalah **sumber kebenaran lampiran final**, bukan URL presigned. URL hanya dipakai untuk `<img>` galeri/preview dan berlaku **5 menit**. Revisi dokumen menyalin link lama, sehingga dokumen FINAL tidak berubah saat pilihan foto di galeri berubah.

## Storage

| Mode | Kapan | Konfigurasi | Catatan |
|---|---|---|---|
| `LOCAL` | dev/test/CI | `FILE_STORAGE_DRIVER=local`, root `.local-storage` | filesystem lokal; **ditolak di `NODE_ENV=production`** karena Vercel FS ephemeral |
| `S3` | production | `FILE_STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, opsional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | S3-compatible (AWS S3, Supabase Storage, Cloudflare R2, MinIO). Bucket privat; server membuat presigned GET 5 menit |
| `DB` | file lama & PDF final | default `file_objects.storage_provider='DB'` | kompatibilitas mundur; `content_base64` tetap dibaca helper storage |

Kunci object: `private/field-photos/{projectId}/{fileId}.jpg`. Tidak ada public-read bucket; `GET /api/files/:id` untuk `LOCAL`/`DB` tetap diverifikasi HMAC + sesi + `requireProject()` + RLS. Untuk `S3`, `GET /api/field-photos` mengembalikan presigned HTTPS URL yang sudah melewati pemeriksaan akses di server.

> Sandbox ini **tidak punya kredensial/bucket nyata**. Uji otomatis memakai driver `LOCAL` di direktori temporer; unggah S3 eksternal dan smoke HTTP produksi harus dilakukan operator setelah environment diisi.

## Keamanan

- Semua handler dibungkus `companyRoute()`; tabel baru `ENABLE + FORCE ROW LEVEL SECURITY` dan 4 policy isolasi per company.
- `FIELD` hanya bisa mengunggah/mengubah pilihan pada proyek tempat ia terdaftar (`requireProject` + `document.upload`); `CLIENT_VIEWER` hanya menerima foto `is_selected_for_report = true` pada DTO workspace, API daftar, dan `GET /api/files/:id`.
- Validasi **bukan sekadar `Content-Type` browser**: magic bytes JPEG/PNG/WebP, kecocokan MIME, batas 5 MB sebelum dan sesudah kompresi, rotasi EXIF, batas sisi terpanjang 1800 px, dan output JPEG. HEIC ditolak dengan pesan konversi yang jelas.
- Kategori dibatasi `BEFORE/PROCESS/AFTER` oleh Zod + CHECK DB; tanggal `YYYY-MM-DD`; deskripsi/lokasi dibatasi panjangnya.
- `field_photos` dan `document_photo_links` memakai composite FK `(company_id, ...)`; trigger `assert_document_photo_scope()` menolak foto dan dokumen lintas proyek. `ON DELETE RESTRICT` mencegah file foto hilang saat masih dipakai.
- Unggahan foto baru **tidak menyimpan base64 di DB**. Aktivitas `UPLOADED`, `SELECTED_FOR_REPORT`, `REMOVED_FROM_REPORT` masuk audit log.
- CSP `img-src` mengizinkan `https:` untuk presigned URL; `X-Content-Type-Options: nosniff` dan `Cache-Control: private, no-store` tetap aktif.

## API

| Endpoint | Peran | Isi |
|---|---|---|
| `POST /api/field-photos` | `document.upload` | `multipart/form-data`: `file`, `projectId`, `category`, `capturedAt`, opsional `description`, `locationLabel`. Balasan `201` berisi `id`, `fileId`, ukuran, dimensi, SHA-256, provider |
| `GET /api/field-photos?projectId=&from=&to=&category=&selectedOnly=` | `document.view` | metadata + `fileUrl` 5 menit. `from`/`to` inklusif; `CLIENT_VIEWER` dipaksa `selectedOnly=true` |
| `POST /api/field-photos/:id/action` | `document.upload` | `{ "action": "SELECT" \| "UNSELECT" }` |
| `GET /api/files/:id?expires=&signature=` | pemilik/anggota proyek | pembacaan `LOCAL`/`DB`; untuk S3 galeri memakai presigned URL langsung |

`POST /api/documents` (`CREATE`) menyertakan foto terpilih hanya untuk `PROGRESS_REPORT`, `BA_SURVEY`, `BA_MOS`, `BA_COMMISSIONING`, `BAST1`, `BAST2`, `CHANGE_ORDER`. `POST /api/documents/:id/action` (`FINALIZE`) menyematkan gambar ke PDF; `REVISE` menyalin `document_photo_links` ke revisi baru.

## Database — `0004_s3_field_photos.sql`

- `file_objects.content_base64` menjadi nullable; tambah `storage_provider` (`DB/LOCAL/S3`), `storage_bucket`, `width`, `height`, `original_size_bytes`.
- `field_photos`: metadata proyek, kategori, tanggal, caption, lokasi, pilihan laporan, urutan, uploader; index `(company_id, project_id, captured_at, category)`.
- `document_photo_links`: lampiran final per dokumen, urutan, pemilih; unique pasangan dokumen/foto.
- Composite company FK + trigger kesamaan proyek + `FORCE RLS` pada 2 tabel baru.
- Total setelah `0004`: **30 tabel bisnis FORCE RLS**, **122 policy** (120 isolasi + 2 RESTRICTIVE internal).
- **Forward-only, tanpa down script.** Backup → `npm run db:migrate -- --check` → `npm run db:migrate` → `npm run db:verify` dari mesin dengan akses DB. Vercel runtime tidak menjalankan migrasi.

## Pengujian

| Perintah | Cakupan |
|---|---|
| `npm test -- tests/unit/field-photos.test.ts` | 11 test: magic bytes, MIME mismatch, HEIC, 5 MB, `sharp`, filter tanggal inklusif/kategori/selectedOnly, `{{#photos}}`, `withPhotoRefs`, storage LOCAL, file DB lama, konfigurasi S3 gagal |
| `npm test -- tests/unit/migrations.test.ts` | 28 test PGlite `0000→0004`: 30 FORCE RLS, 122 policy, nullable `content_base64`, provider CHECK, kategori, filter tanggal SQL, trigger lintas proyek, isolasi company |
| `npm run typecheck && npm run lint && env -u DATABASE_URL -u FILE_SIGNING_SECRET npm run build` | CI lokal; build sengaja tanpa kredensial DB/storage |
| `npm run db:verify` | DB nyata: isolasi 2 company, audit append-only, tabel foto FORCE RLS, 8 policy baru, `content_base64` nullable |

Smoke manual (dengan DB + storage terisi): unggah 3 kategori dengan tanggal berbeda → filter `from/to` batas inklusif → pilih foto → generate `PROGRESS_REPORT` → preview menampilkan gambar → `FINALIZE` → unduh PDF dan pastikan urutan `BEFORE/PROCESS/AFTER` serta caption benar → buat revisi dan pastikan lampiran tetap sama. Uji akun `CLIENT_VIEWER` hanya melihat foto terpilih.

## Risiko & pekerjaan lanjutan

- Kredensial/bucket S3 dan live HTTP smoke **tidak tersedia di sandbox**, sehingga integrasi object storage produksi belum diverifikasi end-to-end.
- PDF final masih disimpan sebagai `base64` di DB mengikuti alur dokumen lama; migrasi seluruh arsip dokumen ke object storage bukan bagian S3.
- `LOCAL` tidak untuk produksi/cluster multi-instance; gunakan S3-compatible storage.
- Presigned URL 5 menit: halaman yang dibiarkan terbuka perlu dimuat ulang untuk mendapatkan URL baru.
- S4 **Document Generator penuh** (template language `{{#...}}`, versi template, editor WYSIWYG) masih ditunda. Kontrak `{{#photos}}` saat ini hanya untuk satu vertical slice ini.
