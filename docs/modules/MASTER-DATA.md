# Master data (tahap 2) — proyek, klien, site & anggota

*Dikerjakan 2026-11-17 setelah hardening-1. Menutup temuan audit **DOM-01** (butir #2–#6 pada
lembar uji scope): tanpa modul ini, aplikasi hanya bisa berjalan di atas data seed.*

| Sebelum | Sesudah |
|---|---|
| Proyek/klien/site/anggota hanya bisa dibuat lewat `scripts/seed-demo.ts` | Menu **Master Data**: wizard proyek 3 langkah, CRUD klien & site, kelola anggota proyek |
| `clients.code` / `projects.code` UNIQUE global (company B tidak bisa memakai kode company A) | UNIQUE `(company_id, code)` — migrasi `0006` |
| Kode proyek dikarang manual | Kode otomatis `PRJ-YYYY-NNN` / `CLI-NNN` dengan advisory lock + index unik sebagai jaring terakhir |
| Anggota proyek hanya dari seed → PM baru tidak bisa membuka proyeknya sendiri | PM otomatis menjadi anggota saat membuat proyek; anggota bisa ditambah/dikeluarkan dari UI |

## 1. Migrasi `0006_master_data_codes.sql`

Forward-only, tanpa down script, **tanpa perubahan data** (hanya constraint & index):

1. Lepas UNIQUE global pada `clients.code`, `opportunities.code`, `projects.code`
   (nama constraint bervariasi, jadi dicari lewat `pg_constraint` berdasarkan `conkey` = kolom `code`).
2. Buat `clients_company_code_idx`, `opportunities_company_code_idx`, `projects_company_code_idx`
   sebagai UNIQUE `(company_id, code)`.
3. Tambah index `sites_client_idx (company_id, client_id)`.

Konsekuensi: dua company boleh memakai kode proyek yang sama, sedangkan duplikat di dalam
satu company tetap ditolak DB (bukan hanya oleh service).

## 2. Hak akses

| Aksi | Izin | Peran |
|---|---|---|
| Lihat menu Master Data | `schedule.view` | semua kecuali yang tidak punya izin jadwal |
| Buat/ubah proyek & anggota, buat/ubah klien & site | `schedule.edit` | ADMIN, PM |
| Arsip klien | `schedule.edit` | ADMIN, PM |

- `requireProject()` tetap dipakai di semua endpoint proyek lain: anggota proyek menentukan
  apakah PM/FIELD/FINANCE dapat membuka workspace proyek.
- ADMIN tidak memerlukan baris `project_members` (perilaku S1 dipertahankan).
- Mengubah proyek COMPLETED (`is_locked`) hanya boleh ADMIN.

## 3. API

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/api/master-data/options` | Opsi form: pengguna aktif company, klien, site, daftar peran proyek. Email hanya untuk ADMIN/FINANCE. |
| `POST` | `/api/projects` | Buat proyek + anggota + audit dalam satu transaksi. PM & pembuat otomatis jadi anggota. |
| `PATCH` | `/api/projects/[id]` | Ubah judul, site, PM, kontrak, retensi, garansi, tanggal. `contractValue` → trigger 0002 menyegarkan `contract_value_current`. |
| `POST` | `/api/projects/[id]/members` | Tambah anggota (menolak pengguna non-anggota company). |
| `DELETE` | `/api/projects/[id]/members/[memberId]` | Keluarkan anggota. Menolak PM proyek dan anggota terakhir. |
| `POST` | `/api/clients` | Buat klien (kode otomatis `CLI-NNN` bila kosong). |
| `PATCH` | `/api/clients/[id]` | Ubah klien, audit diff per field. |
| `POST` | `/api/clients/[id]` | Arsip klien (`{ "action": "ARCHIVE" }`); ditolak bila masih punya proyek. |
| `POST` | `/api/sites` · `PATCH /api/sites/[id]` | Buat/ubah site; site harus milik klien yang sama dengan proyek. |

Semua route dibungkus `companyRoute()` → satu request = satu transaksi = `SET LOCAL` company +
permissions + user. RLS tetap fail-closed.

## 4. Aturan validasi (Zod, dipakai UI & server)

- Kode: `^[A-Z0-9][A-Z0-9._-]{1,39}$` (di-uppercase otomatis).
- Judul proyek ≥ 5 karakter; nama legal klien ≥ 3; nama tampilan ≥ 2; industri ≥ 2.
- `contractValue`, `retentionPct` dikirim sebagai **string desimal** (bukan number JS), konsisten
  dengan modul keuangan lain yang memakai Decimal.
- Tanggal: `targetEndDate ≥ startDate ≥ contractDate`.
- Retensi 0–100%, garansi 0–120 bulan.
- Anggota: `projectRole` harus salah satu dari 7 peran (`PROJECT_ROLES`).
- PATCH proyek menolak body kosong; field yang tidak berubah tidak dikirim
  (agar nilai kontrak berjalan/CO tidak tertimpa angka lama).

## 5. UI

`src/components/MasterDataView.tsx` (menu **Sistem → Master Data**, izin `schedule.view`):

- Tab **Proyek** — daftar + "Ubah" (modal edit: judul, site, kontrak, retensi, tanggal).
- Tab **Klien** — daftar kartu, tambah/ubah, arsip (ditolak bila masih punya proyek).
- Tab **Site** — daftar per klien, tambah/ubah.
- Tab **Anggota** — pilih proyek, tambah/keluarkan anggota; daftar pengguna dimuat saat dibutuhkan.
- **Wizard proyek 3 langkah**: (1) data proyek + klien/site/PM dengan pembuatan cepat klien & site
  inline, (2) kontrak & jadwal, (3) tim. Tahap awal proyek selalu `AWAITING_KICKOFF`; kenaikan tahap
  tetap lewat gerbang tahap yang sudah ada di workspace proyek.

Modal di-*mount* hanya saat terbuka sehingga state form dibaca sekali per open (tanpa
`setState` di dalam effect — aturan React Compiler yang dipakai lint repo ini).

## 6. Verifikasi

```bash
npm run typecheck && npm run lint && npm test
env -u DATABASE_URL -u FILE_SIGNING_SECRET npm run build
```

- `tests/unit/migrations.test.ts` — **32 test** PGlite `0000 → 0006`, termasuk:
  company lain boleh memakai kode proyek identik, duplikat dalam company yang sama ditolak,
  3 index unik `(company_id, code)` ada.
- `tests/unit/master-data.test.ts` — **11 test**: kode otomatis, `maxSequence`, pola kode,
  validasi klien/site/proyek/anggota, PATCH kosong ditolak.
- `npm run db:verify` menambah pemeriksaan ke-10: 3 index kode per company.

**Belum diverifikasi**: `npm run db:migrate` ke database nyata dan smoke HTTP wizard
(sandbox tanpa kredensial DB). `0006` wajib dijalankan manual setelah backup.

## 7. Yang belum termasuk (kandidat tahap berikutnya)

- Termin kontrak (`contract_terms`) dari UI — masih dibuat oleh seed; RAB/PTB lewat modul S2a.
- Sektor/`sector_id`, kategori biaya & satuan kustom (butir #7 lembar uji scope).
- Edit/hapus site, pemindahan proyek antar klien (sengaja ditolak agar histori kontrak aman).
- Undangan pengguna dari wizard proyek (sudah ada di menu **Pengguna**, `users.invite`).
- S4 Document Generator, S5 kurva-S, S6 Price Reference / Sector Profiles.
