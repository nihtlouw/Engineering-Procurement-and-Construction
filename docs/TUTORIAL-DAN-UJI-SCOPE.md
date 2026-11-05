# Tutorial Pakai Ardaya EPC + Cara Menguji Kesesuaian Scope

**Untuk siapa:** pemilik proses / manajemen perusahaan yang ingin tahu *apakah aplikasi ini
cocok untuk cara kerja perusahaan Anda* — bukan untuk programmer.
**Durasi:** 60–90 menit untuk seluruh skenario. Bisa dicicil per bagian.
**Hasil akhir:** Anda punya bukti objektif (bukan opini) tentang apa yang **sudah jalan**,
apa yang **setengah jalan**, dan apa yang **belum ada** — lalu memutuskan lanjut / minta ubah /
tidak cocok.

> **Penting sebelum mulai:** pakai **database percobaan**, jangan database produksi. Aplikasi ini
> otomatis mengisi dirinya dengan data contoh (2 proyek fiktif) kalau tabel pengguna kosong, dan
> menyediakan akun demo dengan password yang sama untuk semua orang.

---

## Bagian 1 — Persiapan (15 menit, sekali saja)

### 1.1 Yang perlu disiapkan

| Kebutuhan | Keterangan |
|---|---|
| Node.js 20+ | `node -v` untuk memeriksa |
| Database PostgreSQL | Gratis di [neon.tech](https://neon.tech), atau Postgres lokal |
| Terminal / Command Prompt | Windows: PowerShell. Mac/Linux: Terminal |
| Browser modern | Chrome/Edge/Safari terbaru |

### 1.2 Langkah instalasi

```bash
# 1. unduh kode
git clone https://github.com/nihtlouw/Engineering-Procurement-and-Construction.git
cd Engineering-Procurement-and-Construction

# 2. pasang dependensi (±2 menit)
npm ci

# 3. siapkan konfigurasi
cp .env.example .env.local
```

Buka `.env.local`, isi tiga baris ini:

```env
DATABASE_URL=postgresql://...        # connection string dari Neon / Postgres lokal
FILE_SIGNING_SECRET=kalimat-rahasia-acak-minimal-32-karakter
SEED_DEMO_PASSWORD=PasswordUjiSaya2026!
```

```bash
# 4. buat tabel di database
npx drizzle-kit push

# 5. jalankan aplikasi
npm run dev
```

Buka **http://localhost:3000**. Data contoh (2 proyek, 12 pengeluaran, 7 invoice) otomatis
dibuat saat login pertama.

### 1.3 Akun demo

Semua akun memakai password yang Anda tulis di `SEED_DEMO_PASSWORD`.
Halaman login menampilkan 4 tombol akun; akun lainnya harus diketik manual.

| Peran | Email | Nama | Fokus |
|---|---|---|---|
| ADMIN | `admin@ardaya.id` | Aditya Nugraha | Semua kontrol & override |
| PM | `pm@ardaya.id` | Bagas Prasetyo | Proyek, biaya, persetujuan |
| FINANCE | `finance@ardaya.id` | Maya Puspita | Tagihan, PPh, reimburse |
| FIELD | `field@ardaya.id` | Rizky Ramadhan | Pengeluaran & progres site |
| PROCUREMENT | `procurement@ardaya.id` | Sinta Maharani | PO & komitmen |
| ESTIMATOR | `estimator@ardaya.id` | Nadia Kusuma | Peluang & penawaran |

### 1.4 Kalau ingin data contoh diganti dengan profil perusahaan Anda

Belum ada menu untuk membuat perusahaan/klien/proyek dari aplikasi (ini salah satu temuan utama —
lihat Bagian 5). Untuk sementara, ubah file `src/db/seed.ts`:

- Nama PT, NPWP, alamat → bagian `db.insert(companySettings)`
- Daftar user & peran → bagian `db.insert(users)`
- Klien & lokasi proyek → `db.insert(clients)` dan `db.insert(sites)`
- Proyek, nilai kontrak, termin → `db.insert(projects)` dan `db.insert(contractTerms)`

Setelah diubah, kosongkan database lalu ulangi `npx drizzle-kit push` dan login.
**Catat ini sebagai temuan**: mengganti identitas perusahaan butuh sentuh kode.

### 1.5 Cara mengulang dari awal

```bash
# hapus seluruh tabel lalu buat ulang (data uji hilang)
npx drizzle-kit push --force
```
Atau di Neon: buat project/branch database baru dan ganti `DATABASE_URL`.

---

## Bagian 2 — Peta aplikasi (5 menit)

Menu kiri (desktop) atau menu bawah (ponsel):

| Menu | Isi | Bisa dipakai untuk… |
|---|---|---|
| **Ikhtisar** | KPI portofolio, daftar risiko, pipeline peluang | Melihat posisi semua proyek sehari-hari |
| **Proyek** | 8 tab: Ringkasan, Lingkup & Anggaran, Jadwal & Progres, Pengadaan & Biaya, Tagihan, Change Order, Serah Terima, Dokumen | Hampir semua pekerjaan proyek |
| **Persetujuan** | Kotak masuk approval bergaya dua panel | Menyetujui/mengembalikan nota |
| **Pengeluaran** | Buku besar biaya + filter status/proyek | Menelusuri biaya |
| **Tagihan** | Daftar invoice, pembayaran, PPh | Menagih & mencatat kas masuk |
| **Dokumen** | 11 template (SPH, BAST 1/2, Invoice, BA survey, dll.) | Membuat dokumen resmi |
| **Peluang** | Kartu pipeline (hanya baca) | Melihat tender berjalan |
| **Audit Trail** | 150 aktivitas terakhir | Menelusuri siapa mengubah apa |
| **Pengaturan** | Profil PT, PPN default, kategori biaya, user | Mengubah parameter |

Tombol aksi yang tersedia: **Catat biaya**, **Buat PO**, **Buat tagihan**, **Generate dokumen**,
**Unggah**.

**Yang perlu Anda sadari sejak awal:** tidak ada tombol **"Proyek baru"**, **"Klien baru"**,
**"Tambah user"**, **"Tambah item jadwal"**, atau **"Edit RAB"**. Itu bukan karena tersembunyi —
memang belum ada. Sisa tutorial akan menunjukkan konsekuensinya.

---

## Bagian 3 — Skenario uji operasional (45 menit)

Kerjakan berurutan. Setiap skenario punya **hasil yang seharusnya muncul** (supaya Anda tahu
aplikasi berjalan benar) dan **pertanyaan uji** (supaya Anda tahu cocok/tidak dengan proses Anda).

### Skenario A — Orientasi dashboard (5 menit) · login `pm@ardaya.id`

1. Login, lihat halaman **Ikhtisar**.
2. Perhatikan 4 kartu KPI, panel **"Fokus hari ini"**, daftar **"Risiko yang dapat ditindaklanjuti"**,
   dan **"Pipeline peluang"**.
3. Klik salah satu kartu proyek → masuk ke workspace proyek **PRJ-2026-014**.

**Angka yang seharusnya muncul** (data contoh, per November 2026):

| Metrik | PRJ-2026-014 (Genset) | PRJ-2025-009 (LVMDP) |
|---|---:|---:|
| Nilai kontrak berjalan | Rp 5.035.000.000 | Rp 1.680.000.000 |
| Biaya aktual | Rp 1.287.450.000 | Rp 793.000.000 |
| Sisa komitmen PO | Rp 1.818.500.000 | Rp 0 |
| Piutang | Rp 1.452.950.000 | Rp 93.240.000 |
| Margin indikatif | Rp 1.884.710.000 | Rp 887.000.000 |
| Progres fisik | 68,7 % | 100 % |

> **Kalau angka Anda berbeda jauh** (mis. 0 semua), berarti konfigurasi database/seed bermasalah —
> hentikan uji dan perbaiki dulu, jangan menilai produk dari data yang salah.

**Pertanyaan uji #1:** Apakah 4–6 angka di Beranda ini sudah cukup untuk rapat pagi Anda?
Kalau Anda butuh arus kas mingguan, biaya per mandor, atau utilisasi alat — catat.

---

### Skenario B — Petugas lapangan mencatat nota (10 menit) · login `field@ardaya.id`

Ini alur yang paling sering dipakai dan paling matang.

1. Menu **Pengeluaran** → tombol **Catat biaya**.
2. **Langkah 1 — Foto & OCR:** unggah foto nota apa pun (atau PDF).
   Klik **Proses OCR** → tunggu. Hasil pembacaan muncul sebagai teks + tombol
   **"Terapkan ke form untuk ditinjau"**.
3. **Langkah 2 — Detail nota:** isi Tujuan biaya (Proyek/Overhead), Proyek, Merchant,
   Nomor nota, Tanggal, Metode pembayaran, Sumber dana (Perusahaan/Karyawan), PPN.
4. **Langkah 3 — Baris biaya:** Uraian, Kategori biaya (EQP/MAT/CIV/LAB/LOG/COM…),
   **Pos anggaran**, Kuantitas, Satuan, Harga satuan. Bisa **Tambah baris**.
5. **Langkah 4 — Tinjau & kirim:** periksa ringkasan → **Simpan & kirim**.

**Hasil yang seharusnya muncul:** nota baru berstatus **Menunggu Persetujuan**, masuk ke kotak
approval PM, dan *belum* masuk biaya aktual.

Uji tambahan yang penting:

| Yang diuji | Cara | Yang seharusnya terjadi |
|---|---|---|
| Nota duplikat | Unggah file yang sama dua kali | Ada peringatan hash/duplikat |
| Total nota ≠ hitungan baris | Isi Total lebih besar dari jumlah baris | Wajib isi **alasan selisih** |
| Mode offline | Matikan Wi-Fi, lalu simpan | Masuk **antrean perangkat**, bisa disinkronkan |
| Overhead kantor | Tujuan biaya = Overhead | Tidak masuk biaya proyek mana pun |

**Pertanyaan uji #2:** Apakah field officer Anda mau mengisi 4 langkah ini?
Kalau di lapangan mereka biasa kirim foto ke WhatsApp group, catat sebagai risiko adopsi.

---

### Skenario C — PM menyetujui nota (5 menit) · login `pm@ardaya.id`

1. Menu **Persetujuan**. Antrean berisi **1 nota**:
   **PT Uji Beban Presisi — Rp 41.625.000** (sewa loadbank 800 kW) dari Rizky Ramadhan.
2. Panel kiri = daftar antrean, panel kanan = **foto nota** (bisa zoom & rotasi) + rincian +
   pos anggaran terdampak.
3. Coba **shortcut keyboard**: `A` = setujui, `R` = minta perbaikan, `X` = tolak.
4. Coba `R` → wajib isi komentar → nota kembali ke pembuat sebagai **Perlu Perbaikan**.

**Hasil yang seharusnya muncul:** nota berpindah status, pembuat menerima notifikasi,
dan aktivitas tercatat di Audit Trail.

**Pertanyaan uji #3:** Kebijakan Anda: siapa boleh menyetujui, sampai nilai berapa?
Di aplikasi ini **satu level persetujuan** dan tidak ada ambang nilai. Kalau perusahaan Anda
mewajibkan "di atas Rp 50 juta harus 2 tanda tangan", itu belum ada.

---

### Skenario D — Anggaran & batas pagu (5 menit) · login `pm@ardaya.id`

1. Buka proyek **PRJ-2026-014** → tab **Lingkup & Anggaran**.
2. Ganti toggle **RAB Klien** ↔ **Anggaran Internal**.
3. Perhatikan kolom **Aktual / Pending / Sisa / Terpakai** dengan warna hijau-kuning-merah.

**Yang perlu Anda uji khusus** — coba habiskan pagu:

1. Catat biaya baru, pilih pos **CIV-01** (anggaran internal Rp 245.000.000).
2. Isi harga satuan **900.000.000** (hampir 4× pagu).
3. Kirim.

**Hasil yang akan Anda lihat: baris ini tetap tersimpan tanpa peringatan.**
Warna kuning/merah hanya tampilan; server tidak menolak. Catat sebagai temuan
(**DOM-03 di backlog**): *"overbudget tidak dicegah sistem, hanya diwarnai"*.

**Pertanyaan uji #4:** Apakah perusahaan Anda butuh *hard stop* saat pagu terlampaui,
atau cukup peringatan dengan approval tambahan?

---

### Skenario E — Pengadaan & komitmen PO (5 menit) · login `pm@ardaya.id`

1. Proyek **PRJ-2026-014** → tab **Pengadaan & Biaya**.
2. Perhatikan 3 PO: `PO/EPC/2026/061` (Diterima Sebagian), `/074` (Diterima), `/088` (Dipesan).
3. Klik **Buat PO**, isi pemasok + DPP → PPN terhitung otomatis → **Status awal: Dipesan**.
4. Pada PO yang sudah ada tagihan, coba tombol **Batal**.

**Yang seharusnya dan yang perlu dicatat:**

| Aspek | Kondisi sebenarnya |
|---|---|
| PO dihitung sebagai komitmen, bukan biaya | ✅ benar, ini pembeda penting |
| Sisa komitmen per PO | ✅ dihitung otomatis |
| Approval PO sebelum "Dipesan" | ❌ **belum ada** — siapa pun dengan izin PO bisa langsung memesan |
| PO dibatalkan padahal sudah ada tagihan | ❌ masih diizinkan (komitmen bisa "hilang" dari laporan) |

**Pertanyaan uji #5:** Apakah PO di perusahaan Anda butuh persetujuan sebelum dikirim ke vendor?
Kalau ya, ini harus ditambahkan sebelum dipakai.

---

### Skenario F — Tagihan, pembayaran, retensi (10 menit) · login `finance@ardaya.id`

1. Menu **Tagihan**. Perhatikan ringkasan **Outstanding** dan **Terlambat**.
2. Buka invoice `096/INV/EPC/X/2026` (progres, jatuh tempo 10 Okt 2026) → status **Terlambat**.
3. Klik **Catat pembayaran** → isi kas diterima + PPh (4(2) Konstruksi / 23) → simpan.
4. Buka invoice `022/INV/EPC/III/2026` (retensi Rp 84.000.000, jatuh tempo 2027).

**Yang sudah benar (uji ini untuk membuktikan sistem berpikir):**
- Pembayaran **melebihi saldo** → ditolak. ✔
- Invoice belum dikirim → tidak bisa dibayar. ✔
- PPh dipisah dari kas diterima → saldo & PPh tidak tertukar. ✔

**Dua celah yang harus Anda catat:**

| Uji | Cara | Hasil sebenarnya | Artinya |
|---|---|---|---|
| Nafsu tagih berlebih | Buat invoice baru **melebihi sisa nilai kontrak** | **Diterima** | Tidak ada kontrol kumulatif tagihan vs kontrak |
| Persetujuan sendiri | Buat invoice, lalu klik **Setujui internal** dengan akun yang sama | **Berhasil** | Pemisahan tugas tidak berlaku untuk invoice (berlaku untuk biaya) |

**Pertanyaan uji #6:** Apakah rekap PPN/PPh masa dan faktur pajak ada di aplikasi?
**Belum.** Yang ada hanya PPN di nilai invoice dan PPh saat pembayaran diterima.
Kalau tim pajak Anda butuh rekap bulanan untuk e-Faktur, itu pekerjaan tambahan.

---

### Skenario G — Dokumen resmi: BAST 1 → PDF (10 menit) · login `pm@ardaya.id`

1. Proyek **PRJ-2026-014** → tab **Dokumen** → **Generate dokumen**.
2. Template: **BAST 1** → **Buat draft & snapshot**.
3. Buka dokumennya → perhatikan pratinjau berformat A4 dengan data proyek terisi otomatis.
4. Coba **Edit blok** → muncul **JSON mentah**. Ini akan menyulitkan PM non-teknis
   (catat sebagai temuan **UX-03**).
5. **Finalisasi & buat PDF** → nomor dokumen otomatis (mis. `001/BAST1/EPC/XI/2026`)
   → PDF terbentuk, tidak bisa diubah lagi.
6. Unduh PDF-nya dan **periksa dengan mata Anda**: apakah terbilang, NPWP, nilai, dan
   tanda tangan pihak tampil benar?

> Perbaikan PDF (pemotongan teks & nominal `Rp-4.850.000.000`) sudah diperbaiki di versi ini.
> Kalau Anda memakai versi lama, lakukan uji ini — itu titik paling berisiko.

7. Coba **Buat revisi** → dokumen lama menjadi *Digantikan*, revisi baru bernomor.

**Pertanyaan uji #7:** Apakah dokumen Anda butuh logo, kop surat resmi, meterai,
atau tanda tangan elektronik? Ketiganya **belum ada** — sekarang hanya teks + garis tanda tangan.

---

### Skenario H — Change order (5 menit) · login `pm@ardaya.id`

1. Tab **Change Order**. Ada `CO-2026-003` (Disetujui, +Rp 185 juta, +14 hari) dan
   `CO-2026-004` (Review Internal, +Rp 42,5 juta).
2. Setujui `CO-2026-004` (wajib alasan), lalu **Implementasikan**.

**Hasil yang seharusnya muncul:** baseline anggaran versi baru tercipta, target selesai bergeser
+3 hari, dan tercatat di audit.

**Celah yang perlu dicatat:** setelah implementasi, **nilai kontrak di master proyek tidak ikut
berubah**. Di dashboard Anda melihat "nilai kontrak berjalan" Rp 5.035.000.000 (sudah termasuk CO),
tetapi di kartu kontrak masih Rp 4.850.000.000. Dua angka untuk hal yang sama
(**DOM-07**) — berbahaya saat rapat dengan klien.

---

### Skenario I — Serah terima & penutupan proyek (5 menit) · login `pm@ardaya.id`

1. Buka proyek **PRJ-2025-009** (LVMDP, tahap **Masa Pemeliharaan**) → tab **Serah Terima**.
2. Lihat **Checklist dokumen wajib** (10 item: As-Built SLD, hasil megger, grounding, loadbank,
   manual book, BA training, BA commissioning, BAST 1, SLO).
3. Lihat **Punch list** dan **(Close-check BR-21)**.
4. Klik **Ajukan tahap berikutnya** untuk menuju **Penutupan**.

**Hasil:** ditolak dengan pesan
*"Masa garansi belum berakhir dan BAST 2 belum tercatat."* ✔ Ini kontrol yang bekerja baik.

5. Bandingkan dengan **PRJ-2026-014**: close-check menunjukkan
   *3 pengeluaran belum final*, *2 punch list terbuka*, *6 dokumen belum lengkap*.

**Celah yang perlu dicatat:** centang checklist tidak terhubung ke dokumen yang diunggah —
seseorang bisa mencentang "BAST 1 ✓" tanpa file BAST 1 ada (**DOM-18 / OPS**).

---

### Skenario J — Audit trail & ekspor (5 menit) · login `admin@ardaya.id`

1. Menu **Audit Trail**: siapa, kapan, objek apa, nilai lama → nilai baru, dan alasan.
2. Menu **Pengeluaran** → tombol **Ekspor** → buka file Excel: kolom kode, tanggal, proyek,
   merchant, kategori, DPP, PPN, total + filter & freeze pane.
3. Coba juga ekspor **Tagihan** dan **Anggaran**.

**Yang perlu dicatat:** tidak ada filter/pencarian di Audit Trail (hanya 150 aktivitas terakhir),
tidak ada ekspor audit untuk auditor eksternal, dan ekspor tidak membedakan peran
(akun tanpa izin tagihan tetap bisa mengunduh file — kosong).

---

## Bagian 4 — Uji peran & kontrol akses (10 menit)

Login bergantian dengan akun berbeda. Catat apakah pembatasan **terasa masuk akal** untuk perusahaan Anda.

| Login sebagai | Yang seharusnya terjadi | Yang perlu Anda nilai |
|---|---|---|
| `field@ardaya.id` | Hanya melihat **proyek yang diikuti**, hanya biaya **miliknya**, tanpa menu Ikhtisar/Tagihan/Audit | Apakah pembatasan ini cocok dengan struktur tim Anda? |
| `finance@ardaya.id` | Bisa semua tagihan & pembayaran; **tidak bisa** mengubah PO | Apakah Finance Anda perlu bisa mengubah PO? |
| `procurement@ardaya.id` | Bisa PO & biaya proyek, tanpa tagihan | — |
| `estimator@ardaya.id` | Hanya Peluang & dokumen; menu Peluang **read-only** | Apakah estimator Anda butuh membuat penawaran (SPH) dari sini? |
| `admin@ardaya.id` | Semua + override beralasan | Siapa di perusahaan Anda yang boleh jadi ADMIN? |

**Temuan yang akan Anda lihat langsung:** login sebagai `field@ardaya.id`, lalu perhatikan
menu **Pengaturan** tidak muncul — benar. Tetapi kalau Anda membuka **mode pengembang browser**
(F12 → Network → dokumen HTML), isi halaman memuat **email seluruh karyawan, NPWP perusahaan,
NPWP klien, dan nilai kontrak** — meskipun tidak ditampilkan di layar.
Ini temuan **SEC-02**: data terkirim ke browser semua peran. Untuk perusahaan yang menganggap
nilai kontrak rahasia, ini serius.

---

## Bagian 5 — Daftar "jalan buntu" yang akan Anda temui

Sengaja dikumpulkan supaya Anda tidak mengira salah klik. Semua ini **belum ada**:

| # | Yang ingin Anda lakukan | Kenyataannya | Dampak ke proses |
|---|---|---|---|
| 1 | Membuat proyek baru | Tidak ada menu/tombol | **Blocker** — hanya bisa lewat edit kode |
| 2 | Menambah klien / lokasi proyek baru | Tidak ada | **Blocker** |
| 3 | Menambah anggota tim ke proyek | Tidak ada | **Blocker** |
| 4 | Menyusun RAB baru / merevisi RAB | Hanya melihat versi dari data contoh | **Blocker** |
| 5 | Menambah item jadwal / milestone / bobot | Tidak ada | Perencanaan tidak bisa diperbarui |
| 6 | Menambah kategori biaya / satuan baru | Tidak ada | Terpaku 9 kategori & 19 satuan bawaan |
| 7 | Menambah user / reset password | Tidak ada | Setiap user baru butuh sentuh kode |
| 8 | Membuat penawaran (SPH) dari Peluang | Peluang hanya baca | Estimator tidak terlayani |
| 9 | Menyetujui PO sebelum dipesan | Tidak ada approval PO | Risiko komitmen tanpa kontrol |
| 10 | Mengedit dokumen tanpa JSON | Editor blok berupa JSON mentah | PM non-teknis kesulitan |
| 11 | Menandai notifikasi "sudah dibaca" | Titik merah tidak pernah hilang | Alarm fatigue |
| 12 | Membagikan tautan ke satu invoice | Tidak ada URL per halaman | Kolaborasi & training sulit |
| 13 | Membuka PDF lama (>5 menit) | Tautan file kedaluwarsa | "Klik PDF gagal" |
| 14 | Portal untuk klien / vendor | Tidak ada | Semua lewat email/WA |
| 15 | Rekap PPN/PPh masa & faktur pajak | Tidak ada | Rekonsiliasi manual |
| 16 | Laporan HSE / QC / NCR / laporan harian | Tidak ada | Bukan pengganti alat kendali lapangan |
| 17 | Kurva-S & EVM (SPI/CPI) | Hanya progres terbobot | Analisis jadwal terbatas |
| 18 | Multi-perusahaan (holding) | Satu profil perusahaan | Tidak bisa dipakai 2 PT sekaligus |
| 19 | Integrasi Accurate / SAP / e-Faktur | Tidak ada API publik | Input ganda ke akuntansi |
| 20 | Tanda tangan elektronik tersertifikasi | Hanya garis tanda tangan | BAST tetap harus dicetak & ditandatangani |

**Cara membaca daftar ini:** nomor 1–4 dan 7 adalah **penghalang utama**. Selama itu belum ada,
aplikasi hanya bisa memamerkan data contoh — belum bisa dipakai untuk proyek perusahaan Anda.
Nomor 16–20 **bukan** kelemahan fatal: produk ini memang diposisikan sebagai *project control*
(biaya–komitmen–tagihan–serah terima), bukan ERP lengkap.

---

## Bagian 6 — Lembar penilaian kesesuaian scope

Buka file **`docs/uji-scope/lembar-kesesuaian-scope.csv`** (bisa dibuka di Excel/Google Sheets).
Isinya **100 kebutuhan proses** yang umum di kontraktor EPC, dikelompokkan dalam 18 area. Untuk setiap baris, isi tiga kolom:

| Kolom | Isi |
|---|---|
| `Status` | `Ya` / `Sebagian` / `Tidak` |
| `Cocok` | `Cocok` / `Perlu ubah` / `Tidak perlu` |
| `Prioritas` | `Wajib` (tanpa ini tidak bisa jalan) / `Penting` / `Nanti` |

Setelah selesai, hitung:

- **Jumlah "Wajib" yang Status = Tidak** → itu **daftar pekerjaan wajib** sebelum go-live.
- **Jumlah "Wajib" yang Cocok = Perlu ubah** → itu **daftar kustomisasi**.
- **Jumlah baris "Tidak perlu"** → fitur yang bisa dicoret dari roadmap, hemat biaya.

Kirim hasilnya kembali; saya bisa terjemahkan langsung menjadi backlog teknis dengan estimasi.

### 6 cara memakai hasil uji ini untuk memutuskan

| Kalau hasil Anda… | Artinya | Tindakan |
|---|---|---|
| Mayoritas "Wajib" = **Ya/Cocok** | Fondasi cocok, kurang kelengkapan | Lanjut **Wave 0 + 1** (±6–8 minggu) |
| Banyak "Wajib" = **Tidak** di master data & RAB | Wajar — ini celah yang sudah teridentifikasi | Prioritaskan wizard proyek & editor RAB |
| Banyak "Wajib" = **Tidak** di HSE/QC/gudang/pajak | Produk tidak sepenuhnya cocok untuk model bisnis Anda | Pertimbangkan integrasi, bukan bangun semua |
| "Cocok = Perlu ubah" mendominasi alur approval | Struktur otorisasi beda | Bangun matriks approval berjenjang |
| Tim lapangan menolak 4 langkah input | Risiko adopsi, bukan fitur | Sederhanakan input / pakai WA bot |

---

## Bagian 7 — Tiga hal yang paling perlu Anda putuskan

1. **Apakah nilai kontrak & NPWP klien boleh terlihat oleh site engineer?**
   Sekarang: terkirim ke browser semua peran. Ini keputusan kebijakan, bukan teknis.
2. **Siapa yang boleh menyetujui, sampai nominal berapa, dan berapa lapis?**
   Sekarang: satu lapis, tanpa ambang nilai, dan pembuat invoice bisa menyetujui invoice-nya sendiri.
3. **Apakah cukup "project control" atau butuh ERP penuh?**
   Kalau perusahaan Anda butuh gudang, HSE, dan penggajian di sistem yang sama — ini bukan
   produk yang tepat, dan memaksakannya akan memakan 3–6 bulan tambahan.

---

## Lampiran — Checklist cetak (centang saat uji)

```
[ ] A. Login PM & cocokkan angka dashboard dengan tabel Bagian 3
[ ] B. FIELD: catat biaya 4 langkah (dengan foto + OCR)
[ ] B2. Uji nota duplikat & selisih total
[ ] C. PM: setujui / kembalikan nota (shortcut A, R, X)
[ ] D. Bukti: overbudget tetap tersimpan tanpa penolakan
[ ] E. PO: buat, amati status, coba batal PO yang sudah ditagih
[ ] F. FINANCE: catat pembayaran + PPh, lalu uji over-invoice & self-approve
[ ] G. Dokumen: BAST 1 → finalisasi → unduh PDF → periksa cetak
[ ] H. Change order: setujui & implementasikan, bandingkan 2 angka nilai kontrak
[ ] I. Serah terima: gate penutupan LVMDP ditolak (benar), cek checklist vs dokumen
[ ] J. Audit trail + ekspor Excel
[ ] K. Login FIELD: periksa menu yang hilang & data di HTML (F12)
[ ] L. Isi lembar-kesesuaian-scope.csv (100 baris)
[ ] M. Tulis 5 kebutuhan yang PALING tidak tergantikan di perusahaan Anda
```

**Total waktu realistis:** 60–90 menit. Kalau Anda hanya punya 20 menit, kerjakan
**A, B, C, D, F** — di situ letak nilai jual dan celah terbesarnya.
