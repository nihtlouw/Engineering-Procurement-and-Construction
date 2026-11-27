# Document Generator penuh (S4)

Status: **selesai** — migrasi `0008_document_templates.sql`, API, admin template,
editor blok visual, DOCX + PDF ke object storage, dan status `ARCHIVED`.

Menutup temuan audit **#10 (P0)** dan baris S4 pada `docs/AUDIT-EPC-2026-11-17.md`:
template yang tadinya hardcode di `src/lib/document-templates.ts` kini dikelola
admin di database, dokumen menghasilkan **PDF dan DOCX**, dan dokumen final tidak
lagi dapat berubah tanpa revisi.

## Sebelum vs sesudah

| Sebelum (S3) | Sesudah (S4) |
|---|---|
| 11 template hardcode di kode; ubah template = deploy ulang | `document_templates` + `document_template_versions`; admin ubah template tanpa rilis |
| Tidak ada upload template DOCX | Upload `.docx` (maks 10 MB, magic bytes `PK\x03\x04`, tag `{nama}` dibaca otomatis) |
| Editor blok = textarea JSON mentah | Editor blok visual (judul, paragraf, kunci–nilai, tabel, tanda tangan, jarak, pindah halaman, galeri foto) |
| PDF disimpan sebagai base64 di DB | PDF **dan** DOCX disimpan di object storage (LOCAL/S3); DB hanya metadata |
| Tidak ada status arsip | Status `ARCHIVED` + alasan wajib + audit; papan dokumen 4 kolom |
| Merge hanya field tetap `snapshot[...]` | Variabel bernama (`tag → source`) yang divalidasi server |

## Migrasi `0008_document_templates.sql`

Forward-only, non-destruktif.

1. **`document_templates`** — `company_id NULL` = template sistem (read-only):
   `code`, `name`, `description`, `category`, `base_code` (asal varian company),
   `version`, `kind ∈ {BLOCKS, DOCX}`, `blocks jsonb`, `docx_file_id`,
   `signature_parties`, `is_active`, `is_system`, `created_by_id`/`updated_by_id`.
   UNIQUE `(company_id, code) WHERE company_id IS NOT NULL` + UNIQUE `code`
   parsial untuk template sistem.
2. **`document_template_variables`** — `tag`, `label`,
   `var_type ∈ {TEXT, MONEY, DATE, ROW_LIST, PHOTOS}`, `source`, `sample_value`,
   `is_required`, `sort_order`. UNIQUE `(template_id, tag)`. **FORCE RLS**.
3. **`documents`** — `template_code` menjadi nullable (dokumen unggahan),
   ditambah `template_id`, `template_name`, `template_snapshot` (salinan template
   saat dibuat), `docx_file_id`, `archived_at`, `archived_by_id`, `archive_reason`.
4. **`document_template_versions`** — jejak versi (blok, DOCX, variabel) supaya
   dokumen FINAL dapat diaudit walau template berubah. **FORCE RLS**.
5. **Seed 11 template sistem** (`tpl-system-*`, `is_system = true`, idempoten).

Setelah 0008: **33 tabel FORCE RLS, 132 policy** (124 + 8 policy company isolation
pada dua tabel template), plus 3 tabel template.

## Alur generator

```
template (DB) ──► snapshot variabel (source → nilai saat generate)
      │                         │
      │                         ├── BLOCKS: blok template + interpolasi {tag}
      │                         └── DOCX: docxtemplater + data tag
      ▼
documents (DRAFT, snapshot beku) ──► editor blok visual ──► preview HTML
      │
      ▼ FINALIZE
nomor 001/CODE/EPC/BULAN/TAHUN (advisory lock 771204)
   ├── PDF  → putObject(private/generated/<project>/<nomor>-r<rev>.pdf)
   └── DOCX → putObject(private/generated/<project>/docx/<id>.docx)
```

- **Sumber variabel** divalidasi `z.enum(VARIABLE_SOURCES)` sehingga tag DOCX
  tidak dapat dipakai membaca kolom arbitrer. 9 variabel default tersedia
  (`projectCode`, `projectTitle`, `clientLegalName`, `siteName`, `contractNumber`,
  `contractValue`, `companyLegalName`, `pmName`, `documentDate`).
- **Tag belum terisi** dilaporkan (`unresolved`) pada respons generate, bukan
  menggagalkan dokumen — kecuali variabel bertanda `isRequired` pada template DOCX
  yang menghasilkan `DOCX_REQUIRED_VARIABLE` (422).
- **FINAL immutable**: `PATCH /api/documents/[id]` menolak dokumen selain
  `DRAFT`/`IN_REVIEW` (409 `DOCUMENT_LOCKED`); perubahan dibuat lewat `REVISE`
  (dokumen lama → `SUPERSEDED`, `revision_no + 1`, link foto disalin).
- **Arsip**: `ARCHIVE` + alasan ≥ 5 karakter → `ARCHIVED`, `archived_at`,
  `archived_by_id`, `archive_reason`, audit `DOCUMENT/ARCHIVED`. Berkas final tetap ada.
- **BAST1/BAST2** tetap mengisi `projects.bast1_date`/`bast2_date` saat finalisasi.

## DOCX (tanpa Chromium)

`src/lib/docx.ts`:

- `isDocxBuffer(buffer)` — validasi magic bytes + `[Content_Types].xml`
  (ekstensi file tidak dipercaya).
- `extractDocxTags(docx)` — membaca `{tag}` skalar dari `word/document.xml`.
- `renderTemplateDocx(docx, data, { required })` — `docxtemplater` + `pizzip`;
  error sintaks template dipetakan ke `DocxTemplateError` (422, bukan 500).
- `buildDocxFromBlocks(blocks, meta)` — DOCX dari blok bila template tidak
  mengunggah berkas; semua teks di-escape XML.

PDF tetap `pdf-lib` dari snapshot yang sama (`src/lib/pdf.ts`). Tidak ada konversi
DOCX→PDF lewat LibreOffice/Chromium (tidak tersedia di Vercel) — lihat
`docs/AUDIT-EPC-2026-11-17.md` §risiko #4.

## API

| Method & path | Fungsi | Izin |
|---|---|---|
| `GET /api/templates` | template sistem + company, variabel, 9 default | login |
| `POST /api/templates` | buat template company | `template.manage` |
| `PATCH /api/templates/[id]` | ubah template (naik versi bila isi berubah) | `template.manage` |
| `POST /api/templates/[id]/action` | `DUPLICATE` / `DEACTIVATE` (+alasan) | `template.manage` |
| `GET /api/templates/[id]/versions` | riwayat versi | login |
| `POST /api/templates/upload` | unggah `.docx` (multipart, ≤ 10 MB) | `template.manage` |
| `GET /api/documents?projectId=` | daftar dokumen proyek | `document.view` |
| `POST /api/documents` | `CREATE` (generate) / `UPLOAD` (dokumen eksternal) | `gendoc.create` / `document.upload` |
| `PATCH /api/documents/[id]` | edit judul + blok (DRAFT/IN_REVIEW) | `gendoc.create` |
| `POST /api/documents/[id]/action` | `FINALIZE` / `REVISE` / `ARCHIVE` | `gendoc.finalize` / `gendoc.create` / `document.upload` |

Kode error: `TEMPLATE_REQUIRED`, `TEMPLATE_INACTIVE`, `UNKNOWN_TEMPLATE`,
`CODE_RESERVED`, `DUPLICATE_CODE`, `SHARED_CATALOG_READONLY` (template sistem),
`INVALID_DOCX`, `FILE_TOO_LARGE`, `DOCUMENT_LOCKED`, `NOT_FINAL`, `REASON_REQUIRED`.

Template sistem **tidak dapat** diubah/dinonaktifkan; UI menawarkan **Duplikat &
ubah** yang membuat varian company (`<CODE>_CUSTOM`, `base_code` terisi).

## UI

- `src/components/documents/TemplateAdmin.tsx` — daftar template (badge sistem/
  aktif/nonaktif/dipakai), modal CRUD (kode, nama, kategori, jenis, upload DOCX,
  editor blok, editor variabel, riwayat versi).
- `src/components/documents/BlockEditor.tsx` — editor blok visual; blok tetap
  disimpan dalam JSON `DocumentBlock` sehingga renderer PDF/DOCX tidak berubah.
- `DocumentsView.tsx` — tab **Papan dokumen** & **Template**, composer memilih
  template dari DB, tombol **Finalisasi (PDF + DOCX)**, **Buka PDF**, **Unduh DOCX**,
  **Buat revisi**, dan **Arsipkan**.

## Uji

- `tests/unit/documents.test.ts` (13 test) — DOCX sah & escaping XML, deteksi buffer
  non-DOCX, `extractDocxTags`, render placeholder, variabel wajib → `DocxTemplateError`,
  interpolasi blok + tag belum terisi, galeri foto, validasi template (blok wajib,
  DOCX wajib berkas, tag duplikat, sumber tidak dikenal, batas 10 MB).
- `tests/unit/migrations.test.ts` (43 test) — menjalankan `0000 → 0008`; blok 0008
  memeriksa 11 template sistem, kode unik per company, CHECK `kind`/`var_type`,
  versi unik, `documents.template_code` nullable, 8 policy + FORCE RLS, kolom baru.
- Total suite: **141 passed / 3 skipped**.
- `scripts/verify-rls.ts` pemeriksaan ke-12: 11 template sistem, 3 tabel template,
  3 kolom dokumen baru.

## Risiko & batasan

- **PDF ≠ DOCX piksel-identik.** PDF dirender dari blok/snapshot; DOCX dari template.
  Bila pelanggan menuntut identik, perlu layanan konversi eksternal (di luar MVP).
- **Gambar di DOCX** belum disematkan (galeri foto hanya di PDF); DOCX memuat daftar
  caption. Menyematkan JPEG dari storage adalah pekerjaan lanjutan.
- **Upload DOCX tidak di-scan malware**; berkas disimpan privat dan hanya admin
  bertanda `template.manage` yang dapat mengunggah.
- **`document_templates` tanpa RLS** (seperti `cost_categories`): isolasi ditegakkan
  filter `company_id IS NULL OR company_id = <aktif>` di service. Tabel variabel &
  versi memakai FORCE RLS.
- **Lama generasi** bergantung ukuran DOCX (murni JS); berkas > 10 MB ditolak agar
  tetap di batas waktu fungsi serverless.
