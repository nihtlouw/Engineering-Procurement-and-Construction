# Ringkasan Desain UI Ardaya EPC

Dokumen ini merangkum hasil redesign antarmuka yang sudah masuk ke `main` lewat empat pull request
(#4 sampai #7). Isinya bukan tutorial fitur, tapi acuan visual dan teknis: apa yang dipakai, kenapa
dipilih, dan aturan yang harus dijaga saat menambah layar baru.

Papan rencana visualnya ada di `design/plan.html` (satu file mandiri, bisa dicetak ke PDF).

---

## 1. Ringkasan satu halaman

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Font antarmuka | Arial (font sistem) | Instrument Sans, di-host sendiri di `public/fonts` |
| Font angka | Arial | IBM Plex Mono, digit tabular |
| Latar aplikasi | `#f3f4ef` | `#F6F6F2` (paper) dengan panel putih |
| Teks sekunder | `#6D7770`, kontras 4,20:1 | `#525C55`, kontras 6,42:1 (lolos WCAG AA) |
| Radius | 4 skala bercampur | 6 (kontrol) / 10 (kartu) / 14 (overlay) / pill |
| Teks terkecil | 8px (139 tempat) | 11px, isi 12,5px, angka utama 25px |
| Fokus keyboard | 1 aturan lokal | satu aturan `:focus-visible` global + fokus terkunci di dialog |
| Animasi | 52 pemakaian Motion, hero parallax | hanya umpan balik 140–220ms, tanpa animasi masuk halaman |
| Halaman masuk | foto latar yang tidak ada | pola garis SVG, tanpa aset gagal muat |
| Keadaan data | tanpa skeleton, tanpa halaman galat | skeleton, kosong, galat, dan 404 berbahasa Indonesia |

---

## 2. Token warna

Nilai diambil dari `src/app/globals.css` (`@theme`), semuanya bisa dipakai sebagai kelas Tailwind
(`bg-ink`, `text-muted`, `border-line`, `bg-ok-bg`, dan seterusnya).

### Netral

| Token | Nilai | Pemakaian |
|---|---|---|
| `ink-900` | `#0E1512` | sidebar, panel gelap |
| `ink-800` / `ink` | `#131C17` | teks utama, tombol primer |
| `ink-500` | `#3D4C45` | garis hover, aksen tipis |
| `paper` | `#F6F6F2` | latar aplikasi |
| `surface` | `#FFFFFF` | kartu dan panel |
| `sunken` | `#FAFAF6` | header tabel, area bersarang |
| `line` | `#E3E5DE` | pemisah utama |
| `hairline` | `#EDEFE8` | pemisah antar baris |
| `muted` | `#525C55` | teks sekunder (6,42:1) |
| `subtle` | `#6A756E` | teks pendukung minimal 11px |

### Aksen dan status

| Token | Nilai | Kontras terukur |
|---|---|---|
| `lime` | `#C6F24E` | 13,44:1 terhadap ink |
| `ok` / `ok-bg` | `#17603C` / `#E8F5EC` | 6,74:1 |
| `warn` / `warn-bg` | `#8A4B00` / `#FDF1DC` | 6,09:1 |
| `danger` / `danger-bg` | `#A2261C` / `#FBEAE8` | 6,37:1 |
| `info` / `info-bg` | `#1F4E79` / `#E7F0F8` | 7,52:1 |

Aturan pakai: satu tombol lime per layar, warna status hanya untuk pill dan garis tipis, angka
negatif memakai danger dan angka positif memakai success.

---

## 3. Tipografi

- **Instrument Sans** untuk seluruh antarmuka. Bobot 400, 500, 600. Dimuat lewat `@font-face` dari
  `public/fonts` (latin + latin-ext, sekitar 41 KB), jadi tidak ada permintaan ke CDN dan bentuk huruf
  sama di semua perangkat.
- **IBM Plex Mono** untuk nominal uang, kode dokumen, dan ID. Selalu dengan `tabular-nums` supaya
  digit tidak bergeser saat nilai berubah.
- Skala: 11 (label), 12 / 12,5 (isi sekunder), 13 / 13,5 (isi), 15 (judul panel), 19–21 (judul
  halaman), 25–34 (angka utama). Tidak ada teks di bawah 11px.
- Huruf kapital hanya untuk label pendek dengan tracking `+.08em` sampai `+.12em`. Maksimal dua bobot
  dalam satu panel.

Cara memakai: `className="text-[12.5px] text-muted"` untuk isi sekunder, `className="mono"` untuk
angka dan kode.

---

## 4. Spasi, radius, elevasi, gerak

- Tangga spasi basis 4px: 4, 8, 12, 16 (di dalam komponen), 20–24 (padding kartu), 32–48 (antar
  bagian), 64 (antar bab halaman).
- Radius hanya tiga nilai plus pill. `rounded-[var(--radius-control)]` untuk kontrol, `-card` untuk
  kartu, `-overlay` untuk modal. Jangan memakai `rounded-xl`/`rounded-2xl` lagi.
- Elevasi hanya tiga tingkat, semuanya bayangan berwarna ink (bukan hitam):
  `shadow-[var(--shadow-e1)]`, `-e2`, `-e3`.
- Kontrol: 32px (kecil), 40px (sedang), 48px (besar). Tabel: tinggi baris 44px, padding sel 12px.
- Gerak hanya untuk umpan balik: 140ms hover/fokus, 160–220ms buka panel. Tidak ada animasi masuk
  halaman, tidak ada parallax, tidak ada `hover:-translate-y`.

---

## 5. Komponen bersama

Semua ada di `src/components/ui.tsx`.

| Komponen | Catatan |
|---|---|
| `Button` | varian `primary`, `secondary`, `ghost`, `danger`, `lime`; ukuran `sm`/`md`/`lg` |
| `Badge` | 5 tone semantik otomatis dari status (`toneFor`), selalu ada teks, tidak hanya warna |
| `Field`, `Input`, `Select`, `Textarea` | label 12px, galat di bawah field, cincin fokus lime 3px |
| `Modal` | fokus terkunci, Escape menutup, fokus kembali ke pemicu, latar tidak bisa digulir, slot `footer` |
| `Toast` | `role="status"` + `aria-live`, posisi aman di ponsel dan desktop |
| `EmptyState` | ikon + judul + penjelasan maksimal 38 karakter per baris + aksi opsional |
| `Skeleton`, `TableSkeleton`, `PanelSkeleton` | bentuk mengikuti konten, bukan spinner tengah layar |
| `SegmentedControl` | pemilih 2–3 opsi (misalnya RAB klien / anggaran internal) |
| `SectionTitle`, `LinkButton` | judul halaman dengan eyebrow dan aksi di kanan |

---

## 6. Pola layar

**Ikhtisar** (`Dashboard.tsx`) — langsung ke pekerjaan: baris KPI (4 sel berbagi garis), antrean
"Perlu tindakan", portofolio dengan dua bilah (progres fisik dan anggaran terpakai), tabel
pengeluaran terbaru, dan pipeline. Tidak ada hero, tidak ada tombol gulir.

**Ruang kerja proyek** (`ProjectWorkspace.tsx`) — header ringkas (kode mono + badge tahap + judul +
aksi), tab underline tipis dengan satu indikator, lalu konten per tab. Tab Ringkasan memisahkan pita
tahap dari strip KPI. Tab Anggaran memakai `SegmentedControl` dan bilah "terpakai" dengan ambang
90% (warning) dan 100% (danger).

**Wizard biaya** (`ExpenseViews.tsx`) — empat langkah dengan garis 3px dan lingkaran 16px; langkah
yang belum dicapai tidak bisa diklik.

**Kotak persetujuan** — panel bukti di kiri dengan latar sunken dan kontrol zoom, ringkasan angka
mono di kanan, aksi setujui/kembalikan/tolak dengan tiga bobot visual berbeda.

**Halaman masuk** (`LoginScreen.tsx`) — panel identitas gelap dengan pola garis SVG, formulir di
kanan, tombol akun demo hanya muncul bila `SEED_DEMO_PASSWORD` diisi.

---

## 7. Keadaan data

- **Memuat**: `src/app/(app)/loading.tsx` (level halaman) dan `PanelSkeleton`/`TableSkeleton`
  (level panel). Ada indikator garis lime di bawah topbar selama refresh server berjalan.
- **Kosong**: `EmptyState` dengan penjelasan dan jalan keluar, bukan teks "tidak ada data".
- **Galat**: `src/app/(app)/error.tsx` — pesan menenangkan, tombol coba lagi dan muat ulang, plus
  kode kejadian `digest` untuk dilaporkan.
- **404**: `src/app/not-found.tsx` berbahasa Indonesia dengan jalan kembali ke ikhtisar.

---

## 8. Aturan yang harus dijaga saat menambah layar

1. Jangan menambah warna di luar token. Butuh warna baru berarti membahas token baru dulu, lengkap
   dengan pengukuran kontras.
2. Jangan menulis kelas radius atau bayangan sendiri. Pakai `var(--radius-*)` dan `var(--shadow-e*)`.
3. Teks minimal 11px. Angka uang selalu `mono` dan rata kanan.
4. Hover hanya mengubah warna atau garis, tidak memindahkan elemen.
5. Setiap panel data wajib punya empat keadaan: isi, memuat, kosong, galat.
6. Status tidak boleh disampaikan lewat warna saja; selalu sertakan teks.
7. Dialog wajib memakai `Modal` dari `ui.tsx` supaya fokus, Escape, dan penguncian gulir konsisten.
8. Jangan memakai em dash di teks antarmuka. Pemisah memakai tengah (`·`) atau tanda pisah (`–`).

---

## 9. Cara memeriksa sendiri

```bash
npm run dev          # buka http://localhost:3000, login pm@ardaya.id / demo1234 (mode demo)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build
```

Papan rencana visual: buka `design/plan.html`. Kalau `design/plan.css` diubah, jalankan
`python3 design/build-plan.py` untuk menanam ulang CSS ke dalam file HTML.

---

## 10. Catatan pemeliharaan

- Font disimpan di `public/fonts` (Instrument Sans variabel latin + latin-ext, IBM Plex Mono 400/500/600,
  total sekitar 96 KB). Tidak ada `next/font` karena sumbernya file lokal yang sudah di-host sendiri.
- Riwayat perubahan: #4 (token, font, primitif, kerangka, Ikhtisar, halaman masuk), #5 (ruang kerja
  proyek, wizard biaya, persetujuan), #6 (keadaan data dan penyisiran akhir), #7 (dedup pengaturan,
  interaksi kartu, aksesibilitas notifikasi).
- Sisa temuan eslint (7 error `react-hooks/set-state-in-effect`, 2 peringatan
  `next/no-html-link-for-pages`) sudah ada sebelum redesign dan sengaja tidak diubah di dalam PR
  desain karena menyentuh logika, bukan tampilan. Layak dikerjakan sebagai PR tersendiri.
