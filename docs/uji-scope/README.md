# Uji Kesesuaian Scope

Folder ini berisi alat bantu untuk memutuskan **apakah Ardaya EPC sesuai dengan kebutuhan
perusahaan Anda**.

| File | Isi |
|---|---|
| `../TUTORIAL-DAN-UJI-SCOPE.md` | Tutorial langkah demi langkah + 10 skenario uji dengan hasil yang diharapkan |
| `lembar-kesesuaian-scope.csv` | 100 kebutuhan proses EPC (18 kelompok) + kolom penilaian untuk Anda isi |

## Cara pakai lembar penilaian

1. Buka `lembar-kesesuaian-scope.csv` di Excel / Google Sheets.
2. Kolom **Sudah Ada** sudah terisi otomatis (hasil uji aplikasi): `Ya` 38 · `Sebagian` 13 · `Tidak` 49.
3. Isi tiga kolom kosong:
   - **Status** — konfirmasi `Ya` / `Sebagian` / `Tidak` menurut pengalaman Anda saat menguji
   - **Cocok** — `Cocok` / `Perlu ubah` / `Tidak perlu` untuk proses perusahaan Anda
   - **Prioritas** — `Wajib` / `Penting` / `Nanti`
4. Hitung:
   - `Prioritas = Wajib` **dan** `Sudah Ada = Tidak` → **daftar pekerjaan wajib** sebelum go-live
   - `Prioritas = Wajib` **dan** `Cocok = Perlu ubah` → **daftar kustomisasi**
   - `Cocok = Tidak perlu` → fitur yang bisa dicoret dari roadmap (hemat biaya)

## Cara membaca hasilnya

| Pola hasil | Kesimpulan | Tindakan |
|---|---|---|
| Mayoritas `Wajib` sudah `Ya`/`Cocok` | Fondasi cocok, tinggal kelengkapan | Lanjut Wave 0 + 1 (±6–8 minggu) |
| Banyak `Wajib` = `Tidak` di master data & RAB | Sesuai temuan analisis | Prioritaskan wizard proyek & editor RAB |
| Banyak `Wajib` = `Tidak` di HSE/QC/gudang/pajak | Model bisnis butuh ERP, bukan project control | Pertimbangkan integrasi, bukan bangun semua |
| `Perlu ubah` mendominasi alur approval | Struktur otorisasi berbeda | Bangun matriks approval berjenjang |

Kirim hasil yang sudah diisi untuk diterjemahkan menjadi backlog teknis + estimasi.
