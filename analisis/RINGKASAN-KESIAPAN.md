# Ardaya EPC — Ringkasan Kesiapan (1 halaman)

**Status:** Demo-grade / pilot-ready · **Skor 2,5 / 5** · **Belum layak produksi**
**Diuji:** aplikasi dijalankan dengan PostgreSQL nyata + 19 skenario fungsional lintas peran
(detail: `ANALISIS-KESIAPAN-DAN-PLAN-UPGRADE.md`)

## 3 hal yang harus diputuskan sekarang

1. **Jangan pakai untuk proyek klien sebelum Wave 0 selesai (±2 minggu).**
   Ada 3 blocker: akun demo bisa ter-seed otomatis di produksi, data NPWP/email/nilai kontrak
   terkirim ke semua peran, dan tidak ada satu pun test otomatis.
2. **Aplikasi belum bisa membuat proyek baru.** Tidak ada endpoint/UI untuk proyek, klien, site,
   anggota, RAB, termin, jadwal. Semua data saat ini berasal dari seed. Ini pekerjaan terbesar
   (Wave 1, 4–6 minggu) dan harus dimulai lebih dulu.
3. **Kendali yang terlihat belum semuanya ditegakkan.** Terbukti: pembuat invoice bisa
   menyetujui invoice-nya sendiri, invoice 9 miliar lolos pada kontrak 4,85 miliar, expense
   overbudget lolos, dan gate milestone bisa dilewati. Untuk produk yang menjual "tanpa blind
   spot", ini risiko kredibilitas tertinggi.

## Yang sudah bagus (jangan dirusak saat upgrade)

- Alur domain EPC benar: DPP/PPN terpisah, retensi, BAST 1/2, change order, punch list,
  termin, material on site — kosakata dan urutannya sesuai praktik kontraktor.
- **Stage gate 9 tahap** + **baseline anggaran immutable** + **audit trail append-only** +
  **SoD** — kombinasi yang biasanya hanya ada di sistem mahal.
- UI konsisten dan terasa seperti produk komersial (kontras teks 14,9:1, mobile-first,
  `prefers-reduced-motion` dihormati). Pembungkus uang memakai `Decimal`, bukan float.

## Yang sudah diperbaiki di sesi ini (commit `cb0bce3`)

| Perbaikan | Sebelum | Sesudah (terverifikasi) |
|---|---|---|
| Renderer PDF dokumen legal | semua string dipotong 110 karakter, non-ASCII → `-`, tabel tanpa kolom | teks terbungkus tanpa potong, `×` tampil benar, tabel bergaris & sadar page-break |
| Nominal di BAST | `Rp-4.850.000.000` (tampak negatif) | `Rp 4.850.000.000` |
| Koneksi database | 1 koneksi putus = proses Node crash | pool punya error handler + timeout, app tetap hidup |

## Angka kunci

| Item | Nilai |
|---|---|
| Temuan dalam backlog | **46** (17 P0 · 25 P1 · 4 P2) |
| Sebaran gelombang | W0 17 · W1 23 · W2 6 |
| Route API | 24 — **tidak satu pun** untuk membuat master data |
| Test otomatis | **0** · CI: **tidak ada** |
| `npm audit` | 1 critical · 2 high |
| Lint | 7 error · 2 warning |
| Index database | **0** (dari 28 tabel) |
| Permission didefinisikan vs ditegakkan | 40 vs **34** |
| Teks 8–10 px | **139** kemunculan |

## Timeline

| Gelombang | Durasi | Hasil |
|---|---|---|
| **W0 — Aman & terpercaya** | 2 minggu | Boleh dipakai untuk data internal asli |
| **W1 — Bisa dipakai proyek baru** | 4–6 minggu | Siap pilot klien (2–3 proyek kecil) |
| **W2 — Siap operasional & komersial** | 6–8 minggu | Production-ready untuk 3–10 proyek aktif |

**Total ±12–16 minggu** dengan 1–2 engineer + UAT domain expert.

## 5 langkah pertama (bisa mulai besok)

1. Matikan auto-seed di produksi dan rotasi password seluruh akun demo.
2. Tambah `error.tsx`, `loading.tsx`, `favicon`, dan aset hero yang hilang.
3. Sempitkan payload per peran (users/clients/NPWP/contractValue) + test matriks role × field.
4. Pasang Vitest dan tulis test untuk `finance.ts` (metrik proyek, retensi, sisa komitmen).
5. Mulai desain wizard proyek (proyek → klien → kontrak → PM → anggota → baseline).

Detail lengkap ada di `ANALISIS-KESIAPAN-DAN-PLAN-UPGRADE.md`, daftar kerja per item ada di
`backlog-upgrade-2026-11.csv`.
