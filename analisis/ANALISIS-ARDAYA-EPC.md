# Analisis Mendalam — Ardaya EPC

**Aplikasi:** https://epc-project-tau.vercel.app/
**Repo:** `nihtlouw/Engineering-Procurement-and-Construction` @ `56477a3`
**Tanggal analisis:** 4 November 2026
**Metode:** uji langsung (live probe) + telaah kode menyeluruh + build/typecheck/lint + audit dependensi
**Lingkup:** produk, domain EPC, arsitektur, keamanan, akuntansi/pajak, kualitas kode, UX, skalabilitas, kesiapan operasional

---

## 0. Ringkasan Eksekutif

### 0.1 Apa yang sebenarnya sedang dinilai

Ardaya EPC **bukan** ERP kontraktor dan bukan pengganti Procore/Primavera. Ini adalah **project control system** untuk kontraktor EPC elektro skala kecil–menengah yang berfokus pada satu rantai nilai yang sangat spesifik:

> nota lapangan → biaya aktual → komitmen PO → tagihan progres → pembayaran/retensi → BAST → penutupan proyek

Rantai itu dijaga oleh tiga mekanisme yang jarang ditemukan di aplikasi internal buatan sendiri:
1. **RBAC per proyek** (role global × keanggotaan proyek × field-level redaction).
2. **Stage gate** 9 tahap proyek dengan syarat dokumen/komitmen yang harus dipenuhi sebelum maju.
3. **Audit trail append-only** + separation of duty (pembuat tidak boleh menyetujui).

Sebagai **prototipe yang siap dipamerkan ke calon klien**, produk ini di atas rata-rata: alur bisnisnya masuk akal, kosakata domainnya benar (DPP, PPN, retensi, BAST 1/2, change order, punch list, material on site), dan UI-nya terasa seperti produk komersial. Sebagai **sistem yang dipakai untuk proyek bernilai miliaran rupiah**, masih ada jarak besar: master data tidak bisa dibuat dari aplikasi, tidak ada satu pun test otomatis, sistem menyemai akun demo sendiri di production, dan semua data proyek dikirim sebagai satu snapshot raksasa ke browser.

### 0.2 Skor per dimensi (1–5)

| Dimensi | Skor | Alasan singkat |
|---|---:|---|
| Kejelasan produk & positioning | 4,0 | Masalah, persona, dan alur sangat jelas; bahasa domain akurat |
| Kedalaman domain EPC | 3,5 | Rantai biaya–komitmen–tagihan–serah terima kuat; engineering/HSE/QC/logistik tidak ada |
| Kontrol internal & auditabilitas | 3,5 | Stage gate, SoD, audit log, immutable document — di atas rata-rata; ada celah eksekusi |
| Keamanan aplikasi | 3,0 | Fondasi baik (scrypt, cookie httpOnly, signed URL, Zod, ORM); eksekusi belum production-grade |
| Kualitas kode & maintainability | 2,0 | 124 baris >400 karakter, lint gagal, 0 test, 0 CI |
| Skalabilitas & performa | 2,0 | Snapshot SSR seluruh tabel, tanpa paginasi, query kuadratik |
| UX / UI | 3,5 | Visual kuat dan konsisten; editor dokumen berupa JSON mentah, font 8–10px masif |
| Kesiapan operasional/enterprise | 1,5 | Tanpa observability, backup/DR, SSO, multi-tenant, dukungan, dokumentasi |
| **Kesiapan produksi keseluruhan** | **2,5** | Layak demo & pilot terbatas; belum layak proyek produksi tanpa perbaikan P0 |

**Putusan:** *Demo-grade / pilot-ready (TRL 5–6)*. Untuk menjadi *production-ready* bagi 3–10 proyek aktif, dibutuhkan sekitar **6–8 minggu kerja 1–2 engineer** untuk P0+P1 (lihat §10). Untuk menjadi produk SaaS multi-tenant, tambah **3–6 bulan**.

### 0.3 Lima temuan paling penting

1. **Produksi bisa menyemai dirinya sendiri dengan akun demo.** `ensureSeed()` dipanggil pada setiap login dan setiap pemuatan workspace; jika tabel `users` kosong, aplikasi membuat 6 akun (termasuk ADMIN) dengan password `SEED_DEMO_PASSWORD` **atau fallback hardcoded `DemoEPC2026!`** (`src/db/seed.ts:32`, `src/app/api/auth/login/route.ts:13`, `src/app/page.tsx:10`).
2. **Kebocoran data lintas peran.** Payload workspace mengirim **seluruh direktori pengguna (email, jabatan, role), seluruh klien + NPWP + kontak, seluruh site, dan NPWP perusahaan** ke setiap pengguna yang login — termasuk FIELD (`src/lib/workspace.ts:107-109`). Nilai kontrak juga tetap ada di objek proyek meski metriknya dihapus untuk FIELD (`src/lib/workspace.ts:63`).
3. **Master data tidak bisa dibuat.** Tidak ada endpoint untuk membuat proyek, klien, site, anggota proyek, anggaran/RAB, termin kontrak, item jadwal, atau peluang. 24 route API hanya menulis transaksi (expense, PO, invoice, CO, dokumen, progres) di atas data yang berasal dari seed. 11 dari 40 permission tidak pernah dipakai (mis. `budget.edit`, `users.manage`, `template.manage`, `proposal.*`, `survey.*`, `design.*`).
4. **Dokumen legal dihasilkan oleh renderer yang lossy.** `src/lib/pdf.ts:8` memotong setiap string pada 110 karakter dan mengganti semua karakter non-ASCII dengan `-`; tabel tidak di-wrap. Untuk BAST, invoice, dan change order, ini adalah risiko fidusia/legal, bukan sekadar bug kosmetik.
5. **Tidak ada jaring pengaman engineering.** 0 file test, 0 workflow CI, `npm run lint` gagal (7 error, 2 warning), build hanya bisa jalan jika `DATABASE_URL` ada saat import, dan seluruh logika finansial kritis (metrik proyek, alokasi diskon, sisa komitmen, retensi) tidak memiliki satu unit test pun.

---

## 1. Metode, bukti, dan batasan

### 1.1 Uji langsung terhadap aplikasi live

| Uji | Hasil | Interpretasi |
|---|---|---|
| `GET /` | 200, halaman login "ARDAYA/EPC" tampil; 4 akun demo terdaftar (PM, FINANCE, FIELD, ADMIN) | Aplikasi hidup dan ter-deploy |
| `GET /api/health` | `{"ok":true}` | Koneksi Neon/Postgres sehat |
| `GET /api/export/expenses` tanpa sesi | `401 {"code":"UNAUTHENTICATED"}` | Auth gate pada API berfungsi, respons JSON konsisten |
| `GET /images/epc-hero.jpg` | **404** | Aset hero hilang; latar login & dashboard kosong di produksi |
| Teks halaman login | "Password demo dikonfigurasi melalui SEED_DEMO_PASSWORD…" | Artinya env `SEED_DEMO_PASSWORD` **diset** di deployment ini, sehingga password tidak dicetak di UI |
| `GET /api/auth/login` | 405 / kosong | Hanya POST, sesuai desain |

### 1.2 Telaah kode

- 51 file sumber, **2.654 baris** TS/TSX, **356.791 karakter** (rata-rata ±134 karakter/baris).
- 24 route API, 27 tabel, 6 role, 40 permission, 11 template dokumen.
- 124 baris melebihi 400 karakter; baris terpanjang **4.837 karakter** (`src/components/ExpenseViews.tsx`).
- 0 `any` eksplisit, 0 `@ts-ignore`, 0 `TODO/FIXME` — disiplin tipe baik, tapi dicapai dengan gaya penulisan yang sangat padat.

### 1.3 Build & kualitas

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | ✅ lulus tanpa error |
| `npm run lint` | ❌ **7 error, 2 warning** (`react-hooks/set-state-in-effect`, `@next/next/no-html-link-for-pages`, `no-img-element`) |
| `npm run build` tanpa `DATABASE_URL` | ❌ gagal saat *collecting page data* (`src/db/index.ts` melempar error di module scope) |
| `npm run build` dengan `DATABASE_URL` dummy | ✅ sukses, 25 route (24 API + `/`) semuanya dinamis (ƒ) |
| `npm audit` | **1 critical, 2 high, 27 moderate** (30 total); critical pada `next`, high pada `postcss` |
| Test otomatis | ❌ tidak ada test runner, tidak ada file test |
| CI/CD | ❌ tidak ada `.github/workflows`, tidak ada pipeline |
| Migrasi DB | ❌ hanya `drizzle-kit push`, tidak ada folder migrasi berversi |

### 1.4 Batasan analisis (penting)

- Saya **tidak dapat login** ke aplikasi live (lingkungan analisis hanya bisa melakukan GET tanpa sesi), sehingga perilaku UI setelah login dianalisis dari kode, bukan dari observasi langsung.
- Saya **tidak memiliki akses** ke database Neon, jadi temuan bersifat telaah kode/konfigurasi, bukan hasil eksploitasi.
- Saya mengasumsikan commit `56477a3` di repo adalah versi yang di-deploy — halaman login live identik dengan `LoginScreen` di repo, dan health check cocok dengan route di repo, sehingga asumsi ini kuat.
- Angka biaya/volume tidak dinilai terhadap data nyata; fokus pada kontrol dan konsistensi perhitungan.

---

## 2. Profil produk

### 2.1 Persona yang dilayani (dan yang belum)

| Role | Yang bisa dilakukan | Kebutuhan utama | Catatan |
|---|---|---|---|
| **ADMIN** | Semua; override beralasan | Kontrol penuh & koreksi | Satu-satunya yang bisa membuka proyek COMPLETED |
| **PM** | Anggaran internal, jadwal, persetujuan biaya, CO, dokumen, tutup proyek | Akuntabilitas margin & jadwal | Persetujuan biaya dibatasi jika ia pembuatnya |
| **FINANCE** | Tagihan, pembayaran, PPh, reimburse, tutup proyek, audit | Kepastian kas & kepatuhan pajak | Tidak punya `purchase.edit`; tidak bisa mengubah PO |
| **PROCUREMENT** | PO, komitmen, lihat biaya proyek | Kecepatan pengadaan & kontrol komitmen | Bisa membuat PO berstatus ORDERED tanpa approval |
| **FIELD** | Input biaya lapangan, progres, unggah nota | Input cepat dari lokasi | Tidak punya `portfolio.view`; default landing ke Proyek |
| **ESTIMATOR** | Peluang, survei, desain, RAB klien, dokumen | Estimasi & penawaran | Modul-estimasi praktis read-only (tidak ada CRUD) |

**Persona yang belum terlayani:** Site Supervisor (harian/HSE), QS/Cost Engineer (pengukuran bersama), Document Controller (register gambar/revisi), Auditor eksternal (read-only + ekspor audit), Klien/MK (portal eksternal), Vendor/subkon (portal PO & invoice).

### 2.2 Jobs-to-be-done yang benar-benar dijawab

✅ "Saya mau tahu, per proyek, berapa yang **sudah dibelanjakan**, berapa yang **sudah dikomitmen**, dan berapa **sisa margin** saya."
✅ "Saya mau memastikan nota lapangan tidak dobel, tidak melebihi PO, dan tidak lolos tanpa persetujuan orang lain."
✅ "Saya mau menagih tepat waktu, mencatat potongan PPh, dan tahu retensi yang masih ditahan klien."
✅ "Saya mau menutup proyek hanya kalau punch list, retensi, dan dokumen serah terima sudah bersih."

❌ "Saya mau membuat proyek baru dan menugaskan tim." — tidak bisa.
❌ "Saya mau menyusun RAB dan meminta approval versi anggaran." — tidak bisa (hanya menetapkan baseline dari data seed).
❌ "Saya mau tahu PPN masukan dan PPh yang harus saya setor bulan ini." — tidak bisa.

### 2.3 Diferensiasi

Kebanyakan alat internal kontraktor berhenti di "input pengeluaran + approval". Ardaya membawa tiga hal yang biasanya hanya ada di sistem mahal: **stage gate proyek**, **versi baseline anggaran yang immutable**, dan **dokumen final dengan snapshot + nomor**. Kombinasi "expense line bisa di-split ke beberapa proyek/overhead" dan "PO overbill harus beralasan" juga menunjukkan pemahaman lapangan yang jarang.

Kelemahan diferensiasi: semua keunggulan itu baru terasa **setelah** data master ada, dan saat ini data master hanya bisa masuk lewat seed.

---

## 3. Cakupan proses bisnis EPC

Legenda: **N** = native (bisa dilakukan penuh dari UI), **S** = sebagian (ada kontrol tetapi tidak lengkap), **–** = tidak ada.

| # | Proses | Status | Bukti / catatan |
|---|---|---|---|
| 1 | Peluang / pipeline / tender | **–** (read-only) | Tabel + tampilan ada; permission `opportunity.edit` tidak dipakai; tidak ada endpoint CRUD |
| 2 | Survei, desain, proposal, SPH | **–** | Template dokumen SPH/BA Survei ada; permission `proposal.*`, `survey.*`, `design.*` tidak dipakai |
| 3 | Estimasi & RAB (klien + internal) | **S** | Bisa melihat, menghitung aktual vs baseline, menetapkan baseline; **tidak bisa membuat/mengedit versi & baris** (`budget.edit` mati) |
| 4 | Kontrak & termin pembayaran | **S** | Termin bisa dipakai saat membuat invoice; tidak ada CRUD termin/kontrak; `contractValue` tidak bisa diubah dari UI |
| 5 | Perencanaan jadwal & bobot | **S** | Progres per item & status; tidak bisa membuat item jadwal, tidak ada dependency, tidak ada kurva-S |
| 6 | Pengadaan: PO & komitmen | **S** | Buat PO, transisi status, sisa komitmen per PO; **tanpa approval, tanpa vendor master, tanpa RFQ/perbandingan, tanpa GRN** |
| 7 | Biaya lapangan / nota | **N** | Composer 3 langkah, OCR, split per baris, alasan selisih, deteksi duplikat, BR-10 (PO terbuka), antrean offline |
| 8 | Tagihan PO (PO bill) | **N** | Wajib tertaut PO, cek akumulasi tagihan vs DPP PO, alasan overbill |
| 9 | Persetujuan biaya | **N** | Transisi state machine, approver PM/FINANCE, SoD, override admin beralasan, notifikasi in-app |
| 10 | Reimburse karyawan | **S** | Pencatatan settlement bertahap; bukti transfer (`proofFileId`) tidak pernah diisi API |
| 11 | Progres fisik | **S** | Update progres + catatan/isu; tanpa verifikasi PM, tanpa foto progres, tanpa bobot wajib 100, tanpa EVM |
| 12 | Change order / addendum | **N** | Alur DRAFT → INTERNAL_REVIEW → AWAITING_CLIENT → APPROVED → IMPLEMENTED; membuat baseline baru & menggeser target akhir |
| 13 | Tagihan ke klien | **N** | Buat, approve, kirim, batalkan (dengan alasan), catat pembayaran + PPh; penomoran otomatis |
| 14 | Retensi | **S** | Ada tipe invoice RETENTION & metrik saldo; **tidak otomatis dipotong** dari invoice progres |
| 15 | Dokumen & template | **N** | 11 template, snapshot, finalisasi PDF bernomor, revisi baru (versi lama SUPERSEDED), arsip unggahan |
| 16 | Punch list | **S** | Tambah/tutup item; tanpa foto, penanggung jawab, tenggat, atau severity |
| 17 | Serah terima BAST 1/2 | **N** | Gate BAST 1 + tanggal otomatis saat finalisasi; checklist handover wajib |
| 18 | Masa pemeliharaan & garansi | **S** | Gate waktu garansi; tanpa tiket warranty/klaim |
| 19 | Penutupan proyek | **N** | 4 close check + kunci proyek + alasan override |
| 20 | Audit trail | **S** | Semua mutasi tercatat; **tanpa diff dokumen yang bermakna, tanpa audit akses file/login** |
| 21 | Laporan & ekspor | **S** | Dashboard + ekspor XLSX (expense/invoice/budget); tanpa PDF laporan manajemen, tanpa arus kas |
| 22 | Pajak (PPN keluaran, PPN masukan, PPh 21/23/4(2), e-Faktur) | **–** | Hanya PPN di invoice/expense dan PPh dipotong klien; tidak ada faktur pajak, PPN masukan, atau withholding vendor |
| 23 | Engineering document control (register gambar, revisi, transmittal) | **–** | Kategori dokumen "DESIGN/ASBUILT" ada, tetapi tanpa register/revisi/transmittal |
| 24 | HSE, QC/QA, NCR, RFI, ITP | **–** | Tidak ada |
| 25 | Material & gudang (MOS, stock, mutasi) | **–** | Template BA MOS ada; tanpa pencatatan material |
| 26 | Subkon & vendor management | **–** | Vendor hanya teks bebas |
| 27 | Tenaga kerja, alat, daily report | **–** | Tidak ada |
| 28 | Arus kas & forecasting | **S** | `forecastExposure = actual + pending + remaining commitment`; tanpa proyeksi kas berbasis termin |
| 29 | Multi-proyek portfolio | **S** | Dashboard portfolio; tanpa konsolidasi perusahaan/overhead P&L |
| 30 | Kolaborasi eksternal (klien, MK, vendor) | **–** | Semua pengguna internal |

**Skor cakupan:** 7 proses native, 12 sebagian, 11 tidak ada. Untuk "project control" inti, cakupannya **kuat**; untuk "EPC management", cakupannya **sempit secara sengaja**.

---

## 4. Arsitektur & model data

### 4.1 Peta sistem

```
┌──────────────────────────── Browser (React 19 / Next 16 client) ───────────────────────────┐
│  LoginScreen → EPCApp (single client shell)                                                 │
│  Dashboard · ProjectWorkspace · ExpenseViews · FinanceViews · DocumentsView · SettingsView  │
│  state: useState + localStorage (view/proyek/tab) + outbox localStorage                     │
└───────────────┬─────────────────────────────────────────────────────────────┬──────────────┘
                │ initial HTML: SATU snapshot WorkspaceData (SSR)             │ POST/PATCH
                ▼                                                             ▼
┌──────────────────────────── Next.js App Router (Vercel) ────────────────────────────────────┐
│ app/page.tsx (force-dynamic)  → getWorkspaceData(user)  ← 25 query tabel dibaca penuh        │
│ app/api/**/route.ts           → requireUser → assertPermission → requireProject → Zod       │
│ lib/finance.ts                → metrik proyek, saldo invoice, close check                    │
│ lib/pdf.ts + pdf-lib          → render dokumen → disimpan sebagai fileObjects (base64)      │
│ lib/auth.ts                   → scrypt, sesi DB, HMAC signed URL file                        │
│ tesseract.js (server)         → OCR nota (sinkron, maxDuration 60)                           │
└───────────────┬──────────────────────────────────────────┬──────────────────────────────────┘
                │ Drizzle ORM (node-postgres Pool)          │ base64 di kolom text
                ▼                                          ▼
        Neon PostgreSQL (27 tabel)                  file_objects (gambar/PDF/XLSX)
```

### 4.2 Pola arsitektur yang dipilih (dan konsekuensinya)

- **BFF monolitik + SSR snapshot.** Semua data dibaca sekali di server component lalu dikirim sebagai props. Tidak ada React Query/SWR, tidak ada paginasi, tidak ada endpoint baca per-entitas.
- **Mutasi via REST route handler**, lalu `router.refresh()` → seluruh workspace dibaca ulang dari database.
- **Tidak ada lapisan service/domain terpisah**: aturan bisnis tersebar di route handler; hanya `finance.ts` yang diekstrak. Ini sebabnya unit test sulit ditambahkan belakangan.
- **File disimpan di database** sebagai base64, bukan object storage.
- **Nomor dokumen/expense/CO** memakai `count(*)` + advisory lock global.

Konsekuensi langsung:

| Pola | Manfaat sekarang | Biaya nanti |
|---|---|---|
| Snapshot SSR | Cepat dibangun, UI konsisten, tidak ada waterfall | Payload membengkak linear terhadap seluruh data; refresh penuh setiap aksi |
| Aturan di route | Sedikit file, mudah dibaca cepat | Duplikasi validasi, sulit diuji, mudah ada route yang lupa cek |
| File di DB | Tidak perlu S3, backup ikut DB | DB bloat, WAL besar, restore lambat, limit body Vercel 4,5 MB |
| `count(*)` + lock | Nomor rapi tanpa tabel counter | Serialisasi global, nomor bolong saat delete, salah tahun saat UTC |

### 4.3 Stack & versi

| Komponen | Versi | Catatan |
|---|---|---|
| Next.js | 16.2.6 | App Router + Turbopack; `npm audit` menandai critical pada rentang ini |
| React / React DOM | 19.2.6 | Client shell besar |
| TypeScript | 5.9.3 | `strict`, typecheck bersih |
| Tailwind CSS | 4.1.17 | `@theme` token; tanpa config file |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | `push` saja, tanpa migrasi |
| PostgreSQL | Neon (pooled) | `pg` 8.20.0, pool global |
| Zod | 4.6.7 | Validasi body, cukup ketat |
| decimal.js | 10.6.0 | Uang sebagai string/numeric — pilihan tepat |
| exceljs / pdf-lib | 4.4.0 / 1.17.1 | Ekspor XLSX & PDF server-side |
| tesseract.js | 7.0.0 | OCR runtime di serverless |
| lucide-react / motion | 1.61.0 / 14.6.0 | Ikon & animasi |
| PostCSS | 8.5.8 | Ditandai high severity oleh audit |

### 4.4 Model data

27 tabel, seluruhnya single-tenant (satu perusahaan), tanpa `company_id`:

- **Master:** `users`, `company_settings`, `clients`, `sites`, `cost_categories`, `units`
- **Pra-proyek:** `opportunities`
- **Proyek:** `projects`, `project_members`, `contract_terms`
- **Anggaran:** `budget_versions`, `budget_lines`
- **Pengadaan:** `purchase_records`
- **Biaya:** `expenses`, `expense_lines`, `expense_settlements`, `file_objects`
- **Pendapatan:** `customer_invoices`, `customer_payments`
- **Eksekusi:** `schedule_items`, `progress_updates`
- **Perubahan:** `change_orders`
- **Serah terima:** `punch_items`, `handover_items`, `documents`
- **Governance:** `sessions`, `activity_logs`, `notifications`

**Yang baik:**
- Uang `numeric(18,2)`, kuantitas `numeric(18,4)`, perhitungan server-side dengan Decimal — jauh lebih aman daripada float.
- Snapshot dokumen (`merge_snapshot` + `blocks`) memisahkan isi final dari data hidup — pola yang benar untuk dokumen legal.
- `budget_version_unique (project, type, version_no)` mencegah duplikasi versi.
- `client_uuid` unik pada `expenses` & `progress_updates` → idempotensi retry.
- `documents.doc_number` unik, `projects.opportunity_id` unik (one-to-one konversi).

**Yang bermasalah:**
- **Tidak ada index eksplisit** selain unique constraint. Kolom yang sering difilter (`project_id`, `approval_status`, `created_at`, `receipt_file_id`, `purchase_record_id`, `invoice_id`) tidak terindeks → sequential scan.
- **Tidak ada kolom versi/optimistic locking** (`version`, `updated_at` tidak dipakai untuk konflik) → lost update mungkin.
- **`file_objects.content_base64`** menyatukan metadata & isi biner dalam satu baris; setiap `select()` yang lupa memproyeksikan kolom akan menarik seluruh file.
- **`projects` tidak menyimpan `contract_ppn` turunan** di metrik; PPN kontrak hanya ada sebagai kolom, tidak dipakai dalam kalkulasi tagihan.
- **`contract_terms` tidak punya status terpakai/tertagih** → tidak bisa mencegah tagihan termin ganda.
- **`expenses.duplicate_reason`** hanya peringatan teks, bukan flag terstruktur.
- **Single-tenant** melekat di skema; menambah multi-company berarti migrasi besar.

### 4.5 Invariant penting: siapa yang menegakkan?

| Invariant | Ditegakkan di | Kualitas |
|---|---|---|
| Hanya anggota proyek yang bisa mengakses proyek | `requireProject()` (`server-services.ts`) | ✅ konsisten hampir di semua route |
| Field-level redaction metrik | `getWorkspaceData` (delete per permission) | ⚠️ hanya di metrik; objek mentah tetap terkirim |
| Total expense = Σ baris + PPN (toleransi Rp1) | `POST /api/expenses`, `SUBMIT` | ✅ dua lapis |
| Diskon dialokasikan proporsional ke baris | `POST /api/expenses` | ✅ ada pembulatan baris terakhir |
| Tagihan PO tidak melebihi PO tanpa alasan | `POST /api/expenses` | ⚠️ hanya alasan, bukan blokir |
| Tagihan klien tidak melebihi kontrak/termin | — | ❌ tidak ada |
| Belanja tidak melebihi pagu RAB | — | ❌ tidak ada |
| Pembuat tidak menyetujui sendiri | expense & change order | ⚠️ invoice tidak; setting `requireSeparationOfDuty` tidak dipakai |
| Proyek COMPLETED terkunci | `requireProject(..., allowLocked)` | ✅ dengan pengecualian admin beralasan |
| Dokumen FINAL immutable | `documents/[id]` & action | ✅ |
| Audit tidak bisa diubah | Konvensi (tidak ada API update/delete) | ⚠️ tidak ada trigger DB / hash chain |

---

## 5. Temuan keamanan

Severity: **K**ritis / **T**inggi / **S**edang / **R**endah. Effort: S ≤1 hari, M 2–5 hari, L 1–3 minggu.

### 5.1 Ringkasan

| ID | Temuan | Severity | Effort |
|---|---|---|---|
| SEC-01 | Auto-seed production + password demo fallback hardcoded | **T** | S |
| SEC-02 | PII & data komersial berlebih di payload workspace | **T** | M |
| SEC-03 | Sesi & CSRF belum diperkuat (7 hari, tanpa rotasi, tanpa Origin check) | **S–T** | M |
| SEC-04 | Rate limit login in-memory, tanpa lockout/MFA | **S** | M |
| SEC-05 | Secret tanda tangan file punya fallback ke `DATABASE_URL` / string lokal | **S** | S |
| SEC-06 | Pipeline file: MIME dari klien, tanpa sniffing/AV, disimpan base64 di DB | **S** | L |
| SEC-07 | OCR sinkron tanpa rate limit/kuota (biaya & DoS) | **S** | M |
| SEC-08 | Tidak ada security header/CSP/HSTS di aplikasi | **S** | S |
| SEC-09 | Audit trail tidak lengkap & tidak tamper-evident | **S** | M |
| SEC-10 | Idempotensi `clientUuid` membocorkan record milik pengguna lain | **R–S** | S |
| SEC-11 | Dependensi rentan (1 critical, 2 high) | **S** | S |
| SEC-12 | Tidak ada middleware auth terpusat & tanpa lifecycle user | **R** | M |
| SEC-13 | Invoice bisa disetujui oleh pembuatnya; toggle SoD mati | **S** | S |
| SEC-14 | Error detail & log berpotensi membocorkan skema/PII | **R** | S |

### 5.2 Detail

**SEC-01 — Auto-seed production (Tinggi).**
`ensureSeed()` dijalankan pada `POST /api/auth/login` dan `getWorkspaceData()`. Bila `users` kosong, aplikasi membuat 6 akun dengan password dari `SEED_DEMO_PASSWORD` **atau** `"DemoEPC2026!"`. Di halaman login, bila env tidak diset, password itu **dicetak di UI** (`src/app/page.tsx:10`). Pada deployment yang dianalisis env sudah diset (password tidak tampil), tetapi akun demo tetap ada dan email-nya dipublikasikan di halaman login. Dampak: deployment baru (staging, preview branch, environment klien) tanpa env yang benar = **akses ADMIN terbuka**. Mitigasi: seed hanya via CLI dengan flag eksplisit, `NODE_ENV !== production`; wajibkan reset password saat pertama login; hapus akun demo di production; rotasi password demo sekarang.

**SEC-02 — PII berlebih (Tinggi).**
`WorkspaceData.users` berisi **semua** user (`safeUser`: id, nama, email, role, title, permissions) dan dikirim ke semua peran, termasuk FIELD (`src/lib/workspace.ts:107`). `clients` (NPWP, alamat, kontak) dan `sites` juga tidak difilter (`:109`), begitu pula `companySettings` (NPWP perusahaan). Objek `projects` memuat `contractValue`, `contractPpn`, `retentionPct` meski metrik `contractValueCurrent` sudah dihapus untuk peran tanpa `budget.client.view` (`:63`). Dampak: kebocoran direktori internal & nilai kontrak ke site engineer/magang; pelanggaran prinsip need-to-know. Mitigasi: proyeksi per permission, bukan redaksi setelah query; kirim hanya user yang relevan (anggota proyek + approver); pisahkan DTO publik vs internal; uji dengan matriks role × endpoint.

**SEC-03 — Sesi & CSRF (Sedang–Tinggi).**
Cookie `httpOnly`, `sameSite=lax`, `secure` di production — dasar baik. Namun: umur absolut 7 hari tanpa rotasi/idle timeout, tidak ada daftar sesi, tidak ada "logout semua perangkat", dan tidak ada pemeriksaan `Origin`/CSRF token. Risiko CSRF aktual rendah karena body JSON + tanpa CORS, tetapi tetap merupakan defense-in-depth yang hilang, dan `sameSite=lax` mengizinkan navigasi top-level GET. Mitigasi: `__Host-epc_session`, rotasi ID saat login, idle 30–60 menit + absolut 12 jam, cek `Origin`/`Sec-Fetch-Site` untuk semua mutasi, token double-submit, sesi per perangkat + revoke.

**SEC-04 — Rate limit login (Sedang).**
`Map` in-memory per instance (`login/route.ts:9`) — pada Vercel setiap instance/cold start punya map sendiri, sehingga 8 percobaan/menit per IP tidak berarti. Map juga tidak pernah dibersihkan (memory leak halus). `x-forwarded-for` diambil apa adanya (di Vercel ditimpa platform, tapi fallback `"local"` menggabungkan semua klien tanpa header). Tidak ada lockout per akun, tidak ada log percobaan gagal, tidak ada MFA. Mitigasi: rate limit terdistribusi (Upstash Redis / tabel Postgres), kunci progresif per email+IP, audit `LOGIN_FAILED`, MFA wajib untuk ADMIN/FINANCE, notifikasi login baru.

**SEC-05 — Secret file (Sedang).**
`signFileToken` memakai `FILE_SIGNING_SECRET`, jika kosong jatuh ke `DATABASE_URL`, lalu ke `"local-epc-file-secret"` (`auth.ts:73`). Artinya deployment yang lupa mengisi env tetap "jalan" dengan kunci yang dapat ditebak/diturunkan. Mitigasi: `throw` saat boot bila secret <32 byte; rotasi; pisahkan secret per environment; token 5 menit sudah baik (tetapi lihat UX di §8).

**SEC-06 — File (Sedang).**
MIME dipercaya dari klien (whitelist), tanpa verifikasi magic bytes, tanpa antivirus, tanpa kuota per pengguna, tanpa enkripsi tambahan. File disimpan base64 di Postgres; `sha256` tidak unik sehingga dedup tidak pernah mengurangi penyimpanan. Logika `duplicateReceipt` membandingkan hash baru dengan `expenses.receipt_file_id` milik file **lama**, sehingga praktis tidak pernah true (`files/route.ts:19-24`). Limit 25 MB tidak realistis di Vercel (body limit ±4,5 MB) → upload besar gagal di platform, bukan dengan pesan yang jelas. Mitigasi: object storage + presigned URL langsung, validasi magic bytes, scan AV, kuota, `sha256` unik dengan referensi, bersihkan file orphan.

**SEC-07 — OCR (Sedang).**
`POST /api/ocr` menjalankan tesseract.js di request path, `maxDuration = 60`, mengunduh traineddata `eng` saat runtime, tanpa rate limit/kuota, dan menyimpan seluruh teks nota (PII) ke `ocr_raw_result`. Siapa pun yang login bisa membebani CPU/egress. Mitigasi: batasi 1 OCR/menit/user, antrean/worker, cache model, atau OCR pihak ketiga; retensi hasil OCR terbatas; hapus teks mentah setelah verifikasi.

**SEC-08 — Header keamanan (Sedang).**
`next.config.ts` kosong. Tidak ada CSP, HSTS (di level app), `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false`. Mitigasi:

```ts
const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];
const nextConfig = { poweredByHeader: false, async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; } };
```

**SEC-09 — Audit (Sedang).**
Semua mutasi utama tercatat, tetapi: edit blok dokumen mencatat placeholder `"DRAFT_BLOCKS" → "EDITED_BLOCKS"` (`documents/[id]/route.ts`), bukan diff; login/logout, akses/unduh file, dan ekspor tidak diaudit; hanya 150 aktivitas terakhir yang dikirim; tidak ada ekspor audit untuk auditor; tidak ada trigger DB yang melarang `UPDATE/DELETE activity_logs`; tidak ada hash chain. Untuk klaim "append-only" di halaman login, ini belum terbukti secara teknis. Mitigasi: diff nyata (jsonb patch), audit akses file & login, trigger imutabilitas, hash chain/penandatanganan harian, retensi 5–10 tahun, ekspor CSV/PDF untuk auditor.

**SEC-10 — Idempotensi lintas pengguna (Rendah–Sedang).**
`POST /api/expenses` mencari `clientUuid` **sebelum** scoping proyek/ownership dan mengembalikan `{id, code}` record yang ditemukan (`expenses/route.ts:31-32`). Bila UUID (yang dikirim klien) diketahui/ditebak, penyerang bisa memastikan keberadaan & kode expense milik pengguna lain. Praktis sulit (UUID v4), tetapi murah diperbaiki: filter `createdById = user.id` dan kembalikan 409 bila milik orang lain.

**SEC-11 — Dependensi (Sedang).**
`npm audit` melaporkan 1 critical (`next`, rentang sangat lebar termasuk versi terpasang), 2 high (`postcss`), 27 moderate (kebanyakan devDependency: eslint, drizzle-kit, exceljs/archiver, minimatch). Mitigasi: naikkan `next` & `postcss` ke patch yang diperbaiki, tambahkan Dependabot/Renovate, `npm audit --omit=dev` di CI, review eksposur nyata (banyak moderate hanya jalur build).

**SEC-12 — Auth terpusat & lifecycle user (Rendah).**
Tidak ada `middleware.ts`; proteksi bergantung pada setiap route memanggil `requireUser`. Saat ini konsisten (diperiksa satu per satu), tetapi satu route baru yang lupa = kebocoran. Tidak ada endpoint ganti password, reset, undang, nonaktifkan, atau `users.manage` — padahal permission-nya ada. Mitigasi: middleware + helper wajib, test matriks otorisasi, modul user management.

**SEC-13 — SoD invoice (Sedang).**
FINANCE memiliki `invoice.edit` dan `invoice.approve`; tabel `customer_invoices` bahkan tidak menyimpan `created_by`, sehingga pembuat invoice dapat menyetujuinya sendiri (berbeda dengan expense/CO yang punya cek `createdById`). `companySettings.requireSeparationOfDuty` ada di skema tapi **tidak pernah dibaca** (hanya 1 kemunculan). Mitigasi: larang self-approval, hormati toggle, pisahkan role "billing" dan "approver", tambahkan ambang nilai.

**SEC-14 — Error & log (Rendah).**
`errorResponse` mengirim `details: error` untuk ZodError (membocorkan nama field/skema) dan `console.error` menulis error mentah (bisa memuat data). Tidak ada request ID. Mitigasi: pesan generik + correlation ID, logging terstruktur tanpa PII, integrasi Sentry.

---

## 6. Temuan domain, akuntansi, dan pajak

| ID | Temuan | Dampak | Severity |
|---|---|---|---|
| DOM-01 | Master data tidak bisa dibuat: proyek, klien, site, anggota, RAB, termin, jadwal, peluang | Aplikasi hanya bisa demo; proyek baru harus lewat seed/SQL | **K** |
| DOM-02 | Tidak ada kontrol pagu: expense & PO tidak dicek terhadap sisa RAB/budget line | Overbudget baru terlihat di dashboard, tidak dicegah | **T** |
| DOM-03 | Tidak ada kontrol tagihan kumulatif vs nilai kontrak/termin | Over-invoicing ke klien mungkin tanpa peringatan | **T** |
| DOM-04 | Pajak tidak lengkap: tanpa faktur pajak, PPN masukan, PPh 23/4(2) vendor, e-Bupot | Rekonsiliasi PPN/PPh manual; risiko kepatuhan | **T** |
| DOM-05 | Retensi tidak otomatis; close check retensi false-negative bila belum pernah ditagihkan | Proyek bisa ditutup dengan retensi belum ditagih | **T** |
| DOM-06 | Matriks approval tidak ada: 1 level, approver = PM atau FINANCE pertama, tanpa ambang nilai/delegasi/SLA | Risiko approval tidak tepat & bottleneck | **T** |
| DOM-07 | Progres tanpa verifikasi & tanpa bobot wajib 100 / EVM | Progres bisa diklaim sepihak; SPI/CPI tidak ada | **S** |
| DOM-08 | Renderer PDF lossy: potong 110 karakter, non-ASCII → `-`, tabel tanpa wrap | Dokumen BAST/invoice tidak sesuai aslinya | **T** |
| DOM-09 | Change order menambah baris anggaran dengan kategori hardcoded `cat-civ` di kedua cabang | Salah klasifikasi biaya | **S** |
| DOM-10 | Tidak ada vendor master; `supplierName` teks bebas | Duplikasi vendor, tidak bisa analisis belanja | **S** |
| DOM-11 | PO bisa dibatalkan setelah ada tagihan disetujui | Komitmen hilang dari metrik padahal tagihan ada | **S** |
| DOM-12 | Tidak ada HSE/QC/NCR/RFI/material/daily report | Tidak cocok untuk proyek yang butuh kendali lapangan | **S** |
| DOM-13 | Multi-currency ambigu: `ppnAmount`/`totalAmount` harus IDR, `originalAmount` dihitung dari total termasuk PPN | Kesalahan kurs & PPN | **S** |
| DOM-14 | Outbox offline bersifat global per perangkat, bukan per pengguna | Draft FIELD A bisa tersinkron sebagai milik FIELD B | **S** |
| DOM-15 | Nomor dokumen & expense memakai `count(*)` dan tahun UTC | Nomor bolong/tabrakan saat hapus & salah tahun 00:00–07:00 WIB | **S** |
| DOM-16 | Settlement reimburse tidak menyimpan bukti transfer (`proofFileId`) | Reimburse tanpa bukti bayar | **S** |
| DOM-17 | `contractValue` tidak berubah saat CO diimplementasikan (hanya penjumlahan di metrik) | Sumber kebenaran ganda: kolom vs kalkulasi | **S** |
| DOM-18 | Handover checklist tidak terhubung ke dokumen wajib tertentu (`documentId` hanya di seed) | Gate dokumen bisa lolos dengan checklist manual | **S** |
| DOM-19 | Punch item tanpa owner/tenggat/foto/severity | Punch list tidak operasional | **R–S** |
| DOM-20 | Tidak ada aging piutang (hanya "overdue") & tidak ada proyeksi kas | Manajemen kas lemah | **S** |

### 6.1 Catatan penting perhitungan (yang perlu diuji)

1. **`actualCost`** hanya menjumlahkan baris `scope = PROJECT` dan status `APPROVED`; overhead dipisah (baik), tetapi expense DRAFT/SUBMITTED tidak masuk `actualCost` (masuk `pendingCost`) — konsisten dengan konsep "aktual".
2. **`remainingCommitment`** = Σ max(DPP PO − tagihan PO yang APPROVED, 0). Bila PO dibatalkan setelah tagihan, tagihan tetap di `actualCost` tetapi komitmen hilang (DOM-11).
3. **`received`** = kas + PPh dipotong klien. Secara kas benar bila PPh dikreditkan; tetapi tidak ada pelacakan bukti potong (bukti potong PPh) sebagai dokumen.
4. **`retentionOutstanding`** = `retentionPct% × contractValueCurrent − pembayaran invoice RETENTION`. Bila retensi belum pernah ditagihkan, nilainya positif — tetapi `buildCloseCheck` memeriksa **saldo invoice retensi**, sehingga proyek bisa lolos close check tanpa retensi ditagih (DOM-05).
5. **`invoiced`** hanya menghitung status SENT/PARTIALLY_PAID/PAID; DRAFT/APPROVED_INTERNAL tidak dihitung (wajar), CANCELLED tidak (wajar).
6. **Alokasi diskon header** proporsional dan baris terakhir menyerap pembulatan — implementasi benar, tetapi tidak ada test yang mengunci perilaku ini.
7. **PPN** tidak dihitung server-side: klien mengirim `ppnAmount`; server hanya memeriksa total = Σ baris + PPN (±Rp1). Jika pengguna mengisi PPN 0, tidak ada yang menolak meski tarif default 11%.
8. **Bobot jadwal** tidak wajib berjumlah 100; metrik menormalkan dengan total bobot (bagus), tetapi item berbobot 0 membuat progres tidak terpengaruh (bisa disalahgunakan).
9. **Tanggal** disimpan `date` string sehingga perbandingan leksikografis aman, tetapi `new Date(...).toISOString()` di beberapa tempat memakai UTC → potensi geser 1 hari untuk aksi pagi WIB.

---

## 7. Kualitas kode & maintainability

| ID | Temuan | Bukti | Dampak |
|---|---|---|---|
| CODE-01 | Tidak ada test otomatis | 0 file test, tidak ada script `test` | Regresi finansial tidak terdeteksi |
| CODE-02 | Lint gagal | `npm run lint`: 7 error, 2 warning | Kualitas tidak terjaga; build tidak memblokir |
| CODE-03 | Gaya "minified" | 124 baris >400 karakter, maks 4.837 | Review, debug, merge conflict sulit |
| CODE-04 | Tanpa migrasi | Hanya `drizzle-kit push` | Tidak ada riwayat/rollback; drift antar environment |
| CODE-05 | Snapshot & query kuadratik | `getWorkspaceData` 25 query penuh; loop proyek × expense; loop budget line × expense | Skala 10 ribu expense → lambat |
| CODE-06 | Tanpa index FK | Hanya unique constraint | Sequential scan |
| CODE-07 | Tanpa paginasi/filter server | Semua array dikirim | Payload & memori |
| CODE-08 | Build butuh `DATABASE_URL` | `src/db/index.ts` throw di module scope | CI/preview tidak bisa build tanpa secret |
| CODE-09 | Tanpa `error.tsx`/`loading.tsx` | Struktur `app/` | Error runtime = halaman default Next |
| CODE-10 | Tanpa observability | Hanya `console.error` | Tidak bisa investigasi insiden |
| CODE-11 | Timezone tidak konsisten | `getFullYear()`, `toISOString().slice(0,10)` | Nomor & tanggal bisa salah |
| CODE-12 | PDF dibuat di dalam transaksi DB | `documents/[id]/action` | Transaksi panjang, lock, timeout |
| CODE-13 | Advisory lock global | `pg_advisory_xact_lock(771201..204)` | Serialisasi semua pembuatan nomor |
| CODE-14 | Signed URL ditanam 5 menit | `workspace.ts:44` | Klik PDF setelah 5 menit → error |
| CODE-15 | Aset hero hilang | `/images/epc-hero.jpg` 404 (live & repo tanpa `public/`) | Halaman login/dashboard tanpa latar |

**Catatan positif:** tidak ada `any`, tidak ada `@ts-ignore`, validasi Zod cukup menyeluruh, pemisahan `finance.ts`/`domain.ts`/`format.ts` tepat, dan `decimal.js` dipakai konsisten. Fondasi untuk diuji dan direfactor ada.

---

## 8. UX, aksesibilitas, dan performa

### 8.1 Kekuatan UX

- Alur biaya 3 langkah (unggah → OCR → verifikasi baris) adalah pola terbaik di aplikasi ini; sangat cocok untuk site engineer.
- Bahasa Indonesia konsisten, istilah teknis tidak diterjemahkan paksa.
- State kosong, loading, toast, badge status, dan konfirmasi alasan sudah dipikirkan.
- Mobile: composer jadi bottom-sheet, navigasi drawer, target sentuh 44px.
- Animasi masuk yang halus (motion) memberi kesan premium.

### 8.2 Masalah UX

| ID | Masalah | Dampak |
|---|---|---|
| UX-01 | Editor blok dokumen berupa **textarea JSON mentah** | PM/site engineer tidak bisa memakai; risiko JSON rusak |
| UX-02 | 139 pemakaian font 8–10px | Sulit dibaca di laptop lapangan & aksesibilitas |
| UX-03 | Modal tanpa `Esc`, focus trap, atau pemulihan fokus | Navigasi keyboard buruk |
| UX-04 | `prefers-reduced-motion` hanya dihargai di Dashboard | Pengguna sensitif gerak terganggu |
| UX-05 | Tidak ada reset password/bantuan login | Pengguna baru terblokir |
| UX-06 | Notifikasi tanpa status dibaca; tidak ada email/WA | Approval bisa terlewat |
| UX-07 | Signed URL 5 menit → "URL kedaluwarsa" saat membuka PDF | Frustrasi; seolah file hilang |
| UX-08 | Tidak ada pencarian/filter/sort di tabel besar; pencarian global hanya 10 hasil | Sulit menemukan data |
| UX-09 | Tidak ada bulk approve / aksi massal | Approval satu per satu |
| UX-10 | Tidak ada indikator "data terakhir diperbarui" selain `generatedAt` | Pengguna ragu kesegaran data |
| UX-11 | Tombol "Buka PDF" adalah `<a>` ke API (lint error) | Navigasi penuh, kehilangan state |
| UX-12 | Halaman login memuat 4 akun demo dengan email asli | Mengaburkan batas demo vs produksi |

### 8.3 Performa

- **Payload awal** = seluruh workspace. Dengan data seed (2 proyek, 12 expense, 7 invoice) masih ringan; dengan 50 proyek & 20.000 expense, payload bisa mencapai puluhan MB dan SSR menjadi 5–20 detik.
- Setiap aksi memicu `router.refresh()` → query 25 tabel + re-render seluruh shell. Tidak ada optimistic update bertarget.
- `getWorkspaceData` melakukan **N+1 in-memory**: untuk setiap budget line memindai semua expense; untuk setiap proyek memindai semua expense/PO/invoice. Kompleksitas mendekati O(P × E + B × E).
- `/api/export/*` memanggil `getWorkspaceData` **sebelum** memvalidasi `type` — pekerjaan berat untuk request yang mungkin 404.
- OCR menambah 2–10 detik (cold start + model) pada request.
- Tidak ada caching/`revalidate`, tetapi juga tidak ada data yang boleh di-cache publik — pilihan `force-dynamic` benar untuk keamanan, mahal untuk performa.

---

## 9. Operasional, skalabilitas, dan kepatuhan

| Area | Kondisi | Risiko |
|---|---|---|
| Deployment | Vercel + Neon, env `DATABASE_URL`, `FILE_SIGNING_SECRET`, `SEED_DEMO_PASSWORD` | Ketergantungan pada dua vendor; tanpa runbook |
| Migrasi | `drizzle-kit push` manual | Drift & downtime tak terencana |
| Backup/DR | Tidak didokumentasikan; mengandalkan Neon PITR | Tanpa uji restore = tidak ada jaminan |
| Observability | Health check saja | MTTR tinggi |
| Kapasitas | Pool default `pg` (10 koneksi/instance) × banyak instance | Kehabisan koneksi Neon saat traffic naik |
| Biaya | File base64 + snapshot penuh + OCR | Biaya egress/DB membengkak tanpa terasa |
| Multi-tenant | Tidak ada `company_id` | Tidak bisa SaaS tanpa refactor |
| SSO | Tidak ada | Blokir adopsi enterprise |
| Audit & retensi | Tidak ada kebijakan retensi/hapus | Risiko kepatuhan |
| UU PDP (Indonesia) | Tanpa kebijakan privasi, dasar pemrosesan, DPO, mekanisme hapus/ekspor, notifikasi insiden | Risiko regulasi saat data klien masuk |
| Dokumentasi | README 30 baris | Onboarding & dukungan sulit |
| Dukungan | Tidak ada SLA/kanal | Adopsi terhambat |

**Catatan kepatuhan pajak Indonesia (tingkat tinggi):** aplikasi menangani PPN 11% dan PPh dipotong klien, tetapi tidak memiliki **faktur pajak keluaran/masukan**, **nomor faktur**, **NPWP lawan transaksi**, **e-Bupot**, **PPh 23 atas jasa**, **PPh 4(2) konstruksi**, **PPh 21**, atau **PPN masukan atas PO/vendor**. Untuk pemakaian nyata, ini berarti rekap pajak tetap dikerjakan di Excel — dan integrasi harus direncanakan sebelum go-live, bukan setelah.

---

## 10. Roadmap perbaikan

### P0 — 0–2 minggu (wajib sebelum menyentuh data klien)

| # | Aksi | Menutup | Effort |
|---|---|---|---|
| 1 | Matikan auto-seed di production; seed via CLI berflag; hapus/nonaktifkan akun demo; rotasi password | SEC-01 | S |
| 2 | Proyeksi data per permission (users, clients, sites, project fields); hapus field sensitif dari DTO | SEC-02 | M |
| 3 | Rate limit terdistribusi + lockout + audit login gagal + MFA untuk ADMIN/FINANCE | SEC-04 | M |
| 4 | Security headers + CSP + `poweredByHeader:false` | SEC-08 | S |
| 5 | Wajibkan `FILE_SIGNING_SECRET` (fail fast), rotasi secret | SEC-05 | S |
| 6 | Larang self-approval invoice; hormati `requireSeparationOfDuty` | SEC-13 | S |
| 7 | Perbaiki lint → 0 error; tambah CI: typecheck, lint, build, test | CODE-02/08 | S |
| 8 | Perbaiki aset hero 404; signed URL dibuat saat klik (endpoint `/api/files/[id]/url`) | CODE-14/15, UX-07 | S |
| 9 | Index DB minimum: `expenses(project_id, approval_status, created_at)`, `expense_lines(expense_id, project_id)`, `activity_logs(project_id, created_at)`, `customer_invoices(project_id)`, `purchase_records(project_id)`, `progress_updates(project_id)` | CODE-06 | S |
| 10 | Perbaiki logika duplikat upload & `cat-civ`; konsistenkan timezone Jakarta | SEC-06, DOM-09, DOM-15 | S |

Contoh index:

```sql
create index expenses_project_status_idx on expenses (default_project_id, approval_status, created_at desc);
create index expense_lines_expense_idx on expense_lines (expense_id);
create index expense_lines_project_idx on expense_lines (project_id);
create index activity_logs_project_idx on activity_logs (project_id, created_at desc);
create index invoices_project_idx on customer_invoices (project_id, status);
create index purchase_project_idx on purchase_records (project_id, status);
create index progress_project_idx on progress_updates (project_id, created_at desc);
create index documents_project_idx on documents (project_id, status);
```

### P1 — 1–3 bulan (layak pilot pada proyek nyata)

1. **CRUD master data**: proyek, klien, site, anggota, termin kontrak, versi & baris RAB, item jadwal, peluang. Ini membuka seluruh alur.
2. **Kontrol anggaran & komitmen**: blokir/warning bila expense/PO melebihi sisa budget line; tampilkan pagu tersisa di composer.
3. **Kontrol penagihan**: kumulatif invoice vs nilai kontrak (+CO) dan vs termin; auto-hitung PPN dari setting; cegah tagihan termin ganda.
4. **Pajak dasar**: field NPWP klien/vendor, nomor faktur pajak, PPN masukan pada PO bill, PPh 23/4(2) pada pembayaran vendor, rekap pajak bulanan (CSV).
5. **Retensi otomatis** pada invoice progres + close check yang benar (retensi harus ditagih atau dinyatakan waived).
6. **Matriks approval**: ambang nilai, delegasi, eskalasi SLA, multi-level.
7. **Object storage + presigned upload + AV scan**; hapus base64 dari DB.
8. **Refactor data access**: paginasi, agregasi SQL, endpoint per-entitas, React Query; kurangi `router.refresh()` penuh.
9. **Test suite**: unit untuk `finance.ts` (metrik, alokasi diskon, saldo, retensi) dan `domain.ts`; integration matriks 6 role × 22 endpoint; E2E alur expense → approve → reimburse dan invoice → pay.
10. **Dokumen**: renderer PDF dengan word-wrap, font Unicode (Noto), nomor per proyek, QR verifikasi; editor blok visual (form, bukan JSON).
11. **Observability**: Sentry, log terstruktur + request ID, alert error rate & latency, uptime check.
12. **Migrasi berversi** + seed terkontrol + dokumentasi runbook/backup/restore.

### P2 — 3–6 bulan (skala & diferensiasi)

- Multi-tenant (`company_id` + RLS), SSO (Google/Microsoft), SCIM, audit akses.
- Engineering document control (register gambar, revisi, transmittal), RFI, NCR/ITP, HSE, daily report, manpower/equipment, material & gudang.
- EVM (SPI/CPI), kurva-S, proyeksi arus kas, multi-currency dengan kurs terkunci, konsolidasi portofolio.
- PWA + sinkronisasi offline sejati (IndexedDB, scoped per user, konflik), kamera/QR, tanda tangan digital (Privy/e-Sign), portal klien/vendor.
- Integrasi akuntansi (Accurate/Xero/SAP), e-Faktur/e-Bupot, WhatsApp/email notification, BI export.
- Paket harga, onboarding, basis pengetahuan, SLA dukungan.

---

## 11. Checklist go-live (production readiness)

- [ ] Tidak ada akun demo & password default; MFA aktif untuk role sensitif
- [ ] Uji otorisasi 6 role × seluruh endpoint (otomatis, di CI)
- [ ] Security header & CSP terpasang; secret wajib & terotasi
- [ ] Rate limit login, upload, OCR, export
- [ ] Index DB & query plan diperiksa pada data 10× seed
- [ ] Payload workspace < 1 MB pada 10 proyek; paginasi tersedia
- [ ] Backup otomatis + uji restore terdokumentasi (RPO/RTO)
- [ ] Migrasi berversi; rollback diuji
- [ ] Monitoring, alert, runbook insiden
- [ ] Log audit tidak bisa diubah + ekspor auditor
- [ ] Kebijakan retensi & penghapusan data (UU PDP), privacy notice, DPA dengan klien
- [ ] Rekap pajak & ekspor akuntansi diverifikasi oleh finance
- [ ] Close check retensi/BAST 2 terbukti benar
- [ ] Dokumen PDF diperiksa terhadap aslinya (BAST, invoice, CO)
- [ ] UAT dengan 1 proyek pilot + pelatihan per role
- [ ] Rencana rollback & freeze window

---

## 12. Lampiran

### 12.1 Inventaris endpoint (24)

| Area | Endpoint | Metode | Permission utama |
|---|---|---|---|
| Auth | `/api/auth/login` | POST | publik + rate limit |
| Auth | `/api/auth/logout` | POST | sesi |
| Biaya | `/api/expenses` | POST | `expense.create` |
| Biaya | `/api/expenses/[id]` | PATCH | `expense.create` + owner |
| Biaya | `/api/expenses/[id]/action` | POST | `expense.create`/`expense.approve`/`expense.void` |
| Biaya | `/api/expenses/[id]/settlements` | POST | `settlement.manage` |
| Pengadaan | `/api/purchases` | POST | `purchase.edit` |
| Pengadaan | `/api/purchases/[id]/action` | POST | `purchase.edit` |
| Tagihan | `/api/invoices` | POST | `invoice.edit` |
| Tagihan | `/api/invoices/[id]/action` | POST | `invoice.approve`/`invoice.edit` |
| Tagihan | `/api/invoices/[id]/payments` | POST | `payment.record` |
| Perubahan | `/api/change-orders` | POST | `changeorder.edit` |
| Perubahan | `/api/change-orders/[id]/action` | POST | `changeorder.edit`/`changeorder.approve` |
| Proyek | `/api/projects/[id]/action` | POST | `schedule.edit`/`budget.approve`/`changeorder.approve`/`project.close` |
| Jadwal | `/api/schedule/[id]/progress` | POST | `progress.create` |
| Dokumen | `/api/documents` | POST | `gendoc.create`/`document.upload` |
| Dokumen | `/api/documents/[id]` | PATCH | `gendoc.create` |
| Dokumen | `/api/documents/[id]/action` | POST | `gendoc.finalize`/`gendoc.create` |
| File | `/api/files` | POST | login |
| File | `/api/files/[id]` | GET | login + signed URL + scope proyek |
| OCR | `/api/ocr` | POST | login + pemilik file |
| Ekspor | `/api/export/[type]` | GET | login + data terlihat |
| Sistem | `/api/settings` | PATCH | `settings.manage` |
| Sistem | `/api/health` | GET | publik |

**Tidak ada endpoint untuk:** proyek (create/update), klien, site, anggota, anggaran/RAB, termin kontrak, item jadwal, peluang, pengguna, notifikasi (baca), audit ekspor, laporan arus kas.

### 12.2 Matriks permission yang tidak terpakai (11 dari 40)

`budget.edit`, `design.edit`, `design.view`, `opportunity.edit`, `proposal.approve`, `proposal.edit`, `proposal.view`, `survey.edit`, `survey.view`, `template.manage`, `users.manage`.

Interpretasi: modul **estimasi/tender, desain, survei, template, dan manajemen pengguna** baru berupa model data/permission, belum berupa fitur. Ini adalah roadmap yang "sudah dijanjikan" oleh domain model tetapi belum dikirim.

### 12.3 Metrik kode

| Metrik | Nilai |
|---|---|
| File sumber | 51 |
| Baris TS/TSX | 2.654 |
| Karakter | 356.791 |
| Route API | 24 |
| Tabel | 27 |
| Role / permission | 6 / 40 (29 dipakai) |
| Template dokumen | 11 |
| Baris >400 karakter | 124 |
| Baris terpanjang | 4.837 (`ExpenseViews.tsx`) |
| Test | 0 |
| CI workflow | 0 |
| Migrasi | 0 |
| Error lint | 7 |
| Warning lint | 2 |
| Advisory package (critical/high) | 1 / 2 |

### 12.4 Cara mereproduksi pemeriksaan

```bash
npm ci
npx tsc --noEmit                      # lulus
npx eslint .                          # 7 error, 2 warning
npm run build                         # gagal tanpa DATABASE_URL
DATABASE_URL=postgresql://u:p@127.0.0.1:5432/d npm run build   # sukses
npm audit                             # 1 critical, 2 high, 27 moderate
```

### 12.5 Asumsi & ketidakpastian

- Deploy live dianggap identik dengan commit `56477a3` (indikasi kuat: halaman login & health check cocok).
- Tidak ada pengujian beban, penetrasi, atau akses database langsung.
- Skor bersifat expert judgment, bukan benchmark formal.
- Estimasi effort mengasumsikan 1–2 engineer familiar dengan stack, tanpa utang teknis lain yang tersembunyi.

---

**Kesimpulan satu paragraf.**
Ardaya EPC adalah fondasi produk yang serius dengan pemahaman domain yang jarang: alur biaya–komitmen–tagihan–serah terima dijaga oleh stage gate, baseline berversi, SoD, dan audit. Namun saat ini ia adalah **sistem kontrol di atas data contoh**, bukan sistem yang bisa menjalankan proyek baru: master data tidak bisa dibuat, pagu dan nilai kontrak tidak dijaga, pajak belum lengkap, dokumen legal dihasilkan secara lossy, dan tidak ada test/CI/observability. Perbaiki P0 dalam dua minggu untuk menghilangkan risiko keamanan dan kredibilitas, lalu P1 dalam 1–3 bulan untuk membuatnya layak dipakai pada proyek nyata pertama.
