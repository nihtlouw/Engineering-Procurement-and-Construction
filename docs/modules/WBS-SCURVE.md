# S5 — WBS & kurva-S

Tahap S5 menutup masalah audit **#10 “tidak ada kurva-S”**: jadwal sebelumnya hanya berupa daftar item dengan satu angka progres, sehingga manajemen tidak bisa melihat apakah proyek tertinggal dari rencana. Setelah S5, rencana fisik punya struktur (WBS), bobot yang dapat dipertanggungjawabkan (Σ = 100%), dan perbandingan rencana vs aktual per minggu.

Migrasi: `drizzle/0009_wbs_scurve.sql`. Kode: `src/modules/wbs/*`, `src/app/api/projects/[id]/{wbs,scurve}/*`, `src/components/schedule/{WbsEditor,WbsPanel,SCurveChart}.tsx`.

## 1. Model data

### `schedule_items` (diperluas)

| Kolom | Tipe | Arti |
|---|---|---|
| `level` | `integer` NOT NULL default 1 | Kedalaman WBS 1–4 |
| `code` | `text` | Kode tampilan `WBS-001`, `3.1`, `3.1.2` |
| `is_summary` | `boolean` NOT NULL default false | Baris grup; bobotnya **selalu 0** dan tidak masuk Σ |
| `committed_amount` | `money` NOT NULL default 0 | Nilai komitmen vendor yang sudah terikat pada aktivitas |
| `planned_pct_per_period` | `numeric(9,4)` | Distribusi rencana per periode (di-backfill 100 untuk item lama) |
| `parent_sort_order` | `integer` NOT NULL default 0 | Urutan anak di dalam induk |

Batasan DB:

- `UNIQUE (company_id, project_id, code) WHERE code IS NOT NULL` — kode unik **per proyek**, bukan per company, sehingga dua proyek boleh sama-sama punya `WBS-001`.
- Index `(company_id, project_id, level, sort_order)` dan `(company_id, parent_id)` untuk render pohon dan cek siklus.
- `CHECK` rentang: `weight` 0–100, `progress_pct` 0–100, `level` 1–4, `planned_pct_per_period` 0–100.
- Backfill di migrasi hanya menyentuh **baris yang ada saat migrasi berjalan** (`level = 1`, `code = WBS-###` hasil `row_number()` per proyek, `planned_pct_per_period = 100`). Item baru wajib mengirim `level`/`code` dari aplikasi; backfill sengaja **tidak** menandai item lama sebagai `is_summary` agar Σ bobot proyek lama tidak berubah menjadi nol.

### `project_wbs_calendars` (baru)

Satu baris per **versi** kalender: `version`, `status` (`DRAFT` | `LOCKED`), `start_date`, `total_weight`, `item_count`, `weighted_progress`, `note`, `locked_at`, `locked_by_id`. Empat policy (SELECT/INSERT/UPDATE/DELETE) dengan `FORCE ROW LEVEL SECURITY`, jadi isolasi company tidak bergantung pada `WHERE` di aplikasi. Total setelah 0009: **34 tabel FORCE RLS / 136 policy** — `npm run db:verify` memeriksa angkanya.

### Tautan ke anggaran

FK parsial `budget_lines.wbs_item_id` dan `budget_phasing.wbs_item_id` (dipasang kondisional: hanya jika data lama bersih). Tujuannya **bukan** memaksa satu struktur biaya sama dengan struktur jadwal, melainkan membuat bobot jadwal dan bobot biaya dapat dibandingkan — perbedaan antara keduanya adalah temuan yang perlu dijelaskan, bukan bug yang harus dirapikan diam-diam. Karena itu migrasi juga menuliskan komentar rekonsiliasi bertipe audit pada tabel.

## 2. Aturan bobot

- Hanya **aktivitas** (`is_summary = false`) yang masuk Σ bobot dan progres terbobot; baris grup wajib berbobot 0 (ditolak validasi bila tidak).
- Σ bobot aktivitas harus **100 ± 0,0001**. Bila belum, `PUT /wbs` menolak dengan `422 WBS_WEIGHT_TOTAL` kecuali klien mengirim `allowIncomplete: true` (draft). Penguncian kalender **selalu** menuntut 100% tanpa pengecualian.
- `evenWeights(n)` dan `normalizeWeights()` menaruh sisa pembulatan pada baris **terakhir** agar hasil dapat diprediksi dan idempoten (`33,33 + 33,33 + 33,34 = 100,00`).
- Progres terbobot = `Σ(bobot × progres) / Σ bobot`; bila Σ bobot belum 100, angkanya dinormalkan dan diberi peringatan eksplisit di UI.

## 3. Matematika kurva-S (`src/modules/wbs/types.ts`)

Fungsi murni, tanpa I/O — seluruhnya diuji di `tests/unit/wbs.test.ts`:

1. `weekStart(date)` menormalkan tanggal ke **Senin** (minggu ISO), `addDays()` aman lintas bulan/tahun.
2. Periode = rentang `startDate → endDate` dibagi mingguan, minimal satu periode.
3. Bobot aktivitas disebar **linier** pada `planned_start → planned_end` (aktivitas tanpa tanggal rencana tidak menyumbang kurva dan dilaporkan sebagai peringatan, bukan dianggap 0 diam-diam).
4. `actualIncrementByPeriod()` mengubah `progress_updates` menjadi delta kumulatif per periode **per item**, lalu dikalikan bobot item tersebut. Update untuk item di luar proyek diabaikan.
5. Kumulatif aktual **carry-forward** untuk minggu tanpa laporan di tengah kurva, tetapi minggu **setelah laporan terakhir** dibiarkan `null` — bukan 0 dan bukan proyeksi. Ini penting: nilai 0 akan terbaca sebagai “progres mundur”, sedangkan proyeksi akan menyembunyikan keterlambatan.
6. `scheduleVerdict(deviasi)` → `AHEAD` (> +0,5), `ON_TRACK` (±0,5), `BEHIND` (< −0,5), atau `NO_DATA` bila belum ada laporan.

Angka dibulatkan 2 desimal **hanya pada keluaran**, perhitungan internal tetap penuh agar akumulasi tidak melenceng.

## 4. API

| Metode & path | Izin | Catatan |
|---|---|---|
| `GET /api/projects/[id]/wbs` | `schedule.view` | Item terurut pohon + riwayat kalender + ringkasan bobot |
| `PUT /api/projects/[id]/wbs` | `schedule.edit` | Replace-by-set dalam satu transaksi; `WBS_SAVED` audit |
| `POST /api/projects/[id]/wbs/action` | `schedule.edit` / `budget.edit` | `LOCK` (alasan ≥5 karakter) atau `LINK_BUDGET_LINE` |
| `GET /api/projects/[id]/scurve` | `schedule.view` | Kurva per minggu + deviasi + status |

Kode galat: `WBS_WEIGHT_TOTAL` (422), `WBS_PARENT_UNKNOWN`, `WBS_LEVEL_INVALID`, `WBS_ITEM_NOT_FOUND`, `WBS_CALENDAR_MISSING`, `PROJECT_LOCKED` (proyek COMPLETED, hanya ADMIN), `FORBIDDEN`.

Simpan WBS bersifat **replace-by-set**: id yang tidak dikirim lagi berarti dihapus (berjenjang ke anaknya), id baru dibuat, dan `removed`/`itemCount`/`totalWeight`/`weightedProgress` dicatat di audit — sehingga “siapa menghapus apa” tetap dapat ditelusuri walaupun barisnya sudah tidak ada.

## 5. Antarmuka

- Tab **Jadwal & Progres** = `WbsPanel` (WBS + kurva-S) di atas `ProgressLog` (daftar jadwal lama + jejak update lapangan, tetap dipakai tim lapangan).
- `WbsEditor`: tabel pohon, indent/outdent, tambah anak, hapus beserta turunan, tombol **Ratakan bobot 100%**, pita bobot dengan penanda Σ ≠ 100, dan mode baca-saja saat peran tidak punya `schedule.edit` atau kalender sudah LOCKED.
- `SCurveChart`: SVG murni (tanpa library chart) sehingga tetap tajam saat dicetak, tanpa permintaan jaringan tambahan; dilengkapi `SCurveTable` untuk angka per periode.
- Dashboard menampilkan Σ bobot dan progres terbobot per proyek, dengan penanda merah bila Σ ≠ 100% agar kurva yang belum valid tidak dibaca sebagai realita.

Mobile-first: tabel WBS memakai `overflow-x-auto` dengan tinggi baris ringkas, tombol aksi berukuran sentuh, dan pita ringkasan 2 kolom pada layar sempit.

## 6. Kriteria penerimaan

1. `npm run db:migrate` menerapkan `0009` pada DB yang sudah berisi item jadwal lama tanpa kehilangan data dan tanpa gagal unique index.
2. `npm run db:verify` melaporkan **34 tabel FORCE RLS / 136 policy** + 3 pemeriksaan 0009 (kolom WBS, kalender terisolasi, backfill lengkap).
3. Menyimpan WBS dengan Σ bobot ≠ 100% ditolak 422; dengan `allowIncomplete` tersimpan tetapi UI menandai merah.
4. Menambah/menghapus item mengubah kode, `itemCount`, dan kurva-S secara konsisten setelah reload; audit `WBS_SAVED` muncul di log aktivitas.
5. Mengunci kalender tanpa alasan ≥5 karakter ditolak; setelah terkunci editor menjadi baca-saja untuk non-ADMIN dan `lockWbsCalendar` mencatat `CALENDAR_LOCKED`.
6. Kurva-S menampilkan rencana kumulatif berakhir 100%, aktual hanya sampai minggu terakhir yang dilaporkan, dan status berubah ke `BEHIND` ketika deviasi < −0,5 poin.
7. `npm run typecheck`, `npm run lint`, `npx vitest run tests/unit/wbs.test.ts tests/unit/migrations.test.ts` hijau.

## 7. Risiko yang masih terbuka

- **Distribusi linier per aktivitas** adalah pendekatan sadar: cukup untuk proyek EPC tipikal, tetapi pekerjaan dengan kurva berat di awal/akhir butuh bobot per periode yang lebih rinci. `planned_pct_per_period` sudah tersedia di skema sebagai jalan masuk tanpa migrasi baru.
- **Aktual berasal dari `progress_updates`**, bukan dari volume terpasang. Bila tim tidak melaporkan, kurva aktual berhenti — deviasi akan tampak negatif. Ini disengaja: kurva-S tidak boleh berbohong karena data yang tidak ada.
- **Bobot jadwal vs bobot biaya** dapat berbeda; S5 menyediakan tautan `wbs_item_id` tetapi tidak memaksa keduanya sama.
- Kurva dihitung saat permintaan (bukan materialized). Untuk proyek dengan ratusan item dan ribuan update, biayanya masih kecil, tetapi bila tumbuh perlu cache per kalender terkunci.
