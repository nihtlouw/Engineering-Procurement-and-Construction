# Ardaya EPC — Analisis Kesiapan Produk & Brief Rencana Upgrade

**Aplikasi:** Ardaya EPC (Engineering · Procurement · Construction Project Control)
**Repo:** `nihtlouw/Engineering-Procurement-and-Construction` @ `67c1e30`
**Tanggal analisis:** 5 November 2026
**Metode:** telaah kode menyeluruh (51 file, 2.698 baris), `typecheck` + `lint` + `build` + `npm audit`,
**aplikasi benar-benar dijalankan** (Next.js 16 + PostgreSQL, data seed), uji API end-to-end
dengan 3 peran berbeda, dan pembacaan ulang PDF yang dihasilkan aplikasi.
**Status dokumen:** temuan P0 PDF & konektivitas **sudah diperbaiki dan diverifikasi** di commit `cb0bce3`.

---

## 0. Ringkasan untuk pengambil keputusan

| Pertanyaan | Jawaban singkat |
|---|---|
| Apakah aplikasi ini **bisa dipakai hari ini**? | **Belum.** Bisa dipakai untuk demo/pilot 1 proyek oleh tim internal, tetapi tidak untuk proyek klien nyata. |
| Apa yang paling menghambat? | (1) **Master data tidak bisa dibuat dari aplikasi** — tidak ada proyek/klien/RAB/jadwal baru; (2) **kebocoran data lintas peran** (NPWP, email, nilai kontrak terkirim ke semua peran); (3) **disiplin internal bisa dilewati** (pembuat invoice menyetujui invoice-nya sendiri; overbudget lolos). |
| Berapa lama sampai layak produksi? | **6–8 minggu** untuk 1–2 engineer (P0 + P1), dengan asumsi domain expert tersedia untuk UAT. |
| Skor kesiapan (1–5) | **2,5 / 5** — *demo-grade, pilot-ready, not production-ready* (TRL 5–6). |
| Yang paling menonjol (kekuatan) | Alur domain EPC benar (DPP/PPN/retensi/BAST/CO/punch list), stage gate 9 tahap, audit trail append-only, baseline anggaran immutable, RBAC per proyek, UI kelas produk komersial. |
| Yang paling berisiko (kelemahan) | Hampir semua kendali berhenti di "lapisan tampilan": data seed, kontrol anggaran hanya visual, hari ini **0 test, 0 CI**, dan dokumen legal dicetak dari renderer yang dulu *lossy*. |

**Putusan:** produk ini **bukan** ERP kontraktor dan tidak perlu menjadi Procore. Ia adalah
*system of control* untuk rantai nilai `nota lapangan → biaya aktual → komitmen PO → tagihan progres →
pembayaran/retensi → BAST → tutup proyek`. Nilai jualnya ada pada **kendali + jejak audit**,
bukan pada kelengkapan modul. Upgrade harus diarahkan ke sana, bukan menambah modul baru.

---

## 1. Bukti: apa yang benar-benar saya uji

Saya tidak hanya membaca kode — aplikasi dijalankan dengan PostgreSQL nyata (bridge WASM
Postgres 18 pada sandbox), data seed dimuat, lalu diuji lewat HTTP sebagai PM, FIELD, dan FINANCE.

### 1.1 Kualitas build & toolchain

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `npm run typecheck` | ✅ lulus | `strict: true`, **0** `any`, **0** `@ts-ignore` |
| `npm run lint` | ❌ **7 error, 2 warning** | `react-hooks/set-state-in-effect` (3×), `no-html-link-for-pages` (2×), `no-img-element` (2×) |
| `npm run build` tanpa `DATABASE_URL` | ❌ gagal saat *collecting page data* | `src/db/index.ts` melempar error di module scope |
| `npm run build` dengan `DATABASE_URL` dummy | ✅ sukses | 25 route, semuanya dinamis (`ƒ`) |
| `npm audit` | **1 critical, 2 high, 14 moderate** | `next` (mis. *middleware/proxy bypass* CVE), `postcss`, `sharp` (libvips/libheif/librsvg) |
| Test otomatis | ❌ **0 file, 0 runner** | tidak ada vitest/jest/playwright |
| CI/CD | ❌ tidak ada `.github/workflows` | tidak ada branch protection |
| Migrasi DB | ❌ hanya `drizzle-kit push` | tidak ada folder migrasi berversi → **tanpa rollback** |

### 1.2 Uji fungsional (nyata, bukan asumsi)

| # | Skenario | Hasil | Makna |
|---|---|---|---|
| 1 | Login `pm@`, `field@`, `finance@` | 200 | Auth & seed bejalan |
| 2 | Pemuatan workspace PM | **200 / ~120–130 KB HTML** | Seluruh dataset dikirim per request; tanpa paginasi |
| 3 | Pemuatan workspace FIELD | 200 / ~66 KB | Lebih kecil karena metrik dihapus, **bukan karena data disaring** |
| 4 | Cek kebocoran di HTML FIELD | `admin@ardaya.id`, `finance@ardaya.id`, NPWP perusahaan, NPWP klien, nilai kontrak **semua ada** | **Kebocoran lintas peran terkonfirmasi** |
| 5 | `POST /api/projects|clients|sites|budgets|schedule|users` | **404 semua** | Master data hanya dari seed |
| 6 | FIELD mengekspor invoice (`/api/export/invoices`) | **200, XLSX 6,7 KB** | Ekspor tidak menghormati `invoice.view` (sheet kosong — *fail-open*) |
| 7 | FINANCE membuat invoice lalu **menyetujuinya sendiri** | **200 → APPROVED_INTERNAL** | SoD hanya ada di expense & change order, **tidak di invoice** |
| 8 | Invoice baru senilai **9 miliar** pada kontrak 4,85 miliar | **201 diterima** | Tidak ada kontrol tagihan kumulatif vs nilai kontrak |
| 9 | Expense 900 jt ke pos anggaran 245 jt | **201 diterima** | Tidak ada validasi pagu anggaran di backend (hanya warna kuning/merah di UI) |
| 10 | PM memakai `clientUuid` milik FIELD | 200 `idempotent: true` + **ID expense milik FIELD** | Enumerasi record lintas pengguna |
| 11 | Pembayaran melebihi saldo invoice | **422 ditolak** ✅ | Kontrol ini **ada dan benar** |
| 12 | FINANCE menyetujui invoice sebelum `SEND` | 409 ditolak ✅ | State machine invoice benar |
| 13 | PM tanpa `settings.manage` mengubah pengaturan | **403** ✅ | RBAC endpoint benar |
| 14 | PM maju tahap `IN_PROGRESS → TESTING_COMMISSIONING` dengan milestone terbuka | **200 lolos** | Gate milestone **tidak ditegakkan** (hanya dicek untuk `HANDOVER`) |
| 15 | Generate + finalize BAST 1 → PDF | 200, nomor `003/BAST1/EPC/XI/2026` | Alur dokumen berfungsi |
| 16 | Teks PDF BAST (sebelum perbaikan) | `Sistem Genset 2 - 500 kVA - NDC Jakarta 2`; `Rp-4.850.000.000` | **`×` → `-`, nominal tampak negatif** |
| 17 | Teks PDF BAST (setelah perbaikan `cb0bce3`) | `Sistem Genset 2 x 500 kVA - NDC Jakarta 2`; **`Rp 4.850.000.000`**; paragraf panjang terbungkus | ✅ diperbaiki & diverifikasi |
| 18 | `/images/epc-hero.jpg`, `/favicon.ico`, `/robots.txt` | **404 semua** | Halaman login & dashboard tampil tanpa visual utama |
| 19 | Proses Node saat koneksi DB terputus | **crash** `uncaughtException` | Pool tanpa handler `error` → seluruh app mati |

### 1.3 Angka kode

| Metrik | Nilai |
|---|---|
| File sumber | 51 (`src/**`), 2.698 baris, ±359 KB |
| Rata-rata panjang baris | **133 karakter** — 124 baris > 400 karakter, terpanjang **4.837 karakter** |
| Route API | 24 (semua `force-dynamic`) |
| Tabel database | 28 |
| Permission didefinisikan | 40 — **6 tidak pernah ditegakkan** (`template.manage`, `users.manage`, `proposal.edit`, `proposal.approve`, `budget.edit`, `design.edit`) |
| Index database | **0** (hanya 2 unique index) |
| Elemen interaktif (`onClick`) | 105, `aria-label` hanya **8**, `role=` **2**, `onKeyDown` **0** |
| Font 8–10 px | **139 kemunculan** (`text-[9px]` 37×, `text-[10px]` 98×, `text-[8px]` 4×) |

---

## 2. Penilaian teknis

### 2.1 Arsitektur (apa adanya)

```
Browser (1 komponen client raksasa: EPCApp 897 baris)
   │  initialData = SELURUH WorkspaceData (SSR)
   ▼
Next.js App Router (src/app/page.tsx → getWorkspaceData)   ← tanpa middleware
   │  24 route API, semuanya validasi Zod + RBAC manual
   ▼
Drizzle ORM ──► PostgreSQL (Neon)
   │
   └─► file_objects: biner base64 DI DALAM database
```

Pola yang dipilih: **"SSR snapshot + refresh penuh"**. Setiap aksi sukses memanggil
`router.refresh()` → server mengirim ulang **seluruh** workspace. Sederhana dan konsisten,
tetapi menjadi batas skala utama.

**Konsekuensi terukur**
- Tidak ada *cache layer* di klien: setiap simpan/approve = 1 full page render.
- Tanpa paginasi/filter server: 10.000 expense berarti payload ~5–10 MB dan query O(n²)
  (`filter` bersarang di `workspace.ts` untuk setiap baris anggaran).
- Semua state UI (termasuk "halaman aktif") disimpan di `localStorage` + `useState`;
  `router.push`/URL **tidak dipakai sama sekali** → tidak bisa di-bookmark, tidak ada deep link,
  tombol Back browser meninggalkan aplikasi.

### 2.2 Kualitas kode

**Kuat:** satu `schema.ts` Drizzle sebagai sumber tipe, `Decimal.js` untuk uang (bukan float),
Zod di 21 titik, 24/24 route memiliki `try/catch` + pemetaan error seragam
(`UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_TRANSITION`, dst.), helper domain terpusat
(`permission`, `assertTransition`, `requireProject`, `audit`).

**Lemah:**
- Gaya "satu baris satu komponen" membuat review mustahil; 1 file = 1.783 baris (ExpenseViews).
- Semua komponen `"use client"` → **tidak ada Server Component**, seluruh JS dikirim ke browser.
- Duplikasi logika: `EpcApp` punya `SettingsPanel` **dan** ada `SettingsView` (versi editable) —
  keduanya dirender di tempat berbeda dengan data sama.
- Validasi bisnis tersebar di route (mis. `overBillReason`, `mismatchReason`, `waktu WIB`) dengan
  helper ad-hoc, bukan satu lapisan *domain service* yang bisa diuji.

### 2.3 Keamanan & kontrol internal

| Area | Kondisi | Risiko |
|---|---|---|
| Auth | scrypt + `timingSafeEqual`, session cookie `httpOnly`+`secure`+`sameSite=lax` | Fondasi baik |
| Rate limit login | `Map` in-memory, kunci per IP, 8/menit | Hilang saat instance restart; mudah dilewati dengan rotasi IP |
| **Auto-seed** | `ensureSeed()` dipanggil di **setiap login & setiap load workspace**; jika `users` kosong → 6 user (termasuk ADMIN) dibuat dengan `SEED_DEMO_PASSWORD` **atau fallback hardcoded `DemoEPC2026!`** | **P0** — produksi bisa menyemai akun demo |
| Otorisasi | dicek per route via `requireProject` | Tidak ada middleware → route baru rawan lupa |
| **Data exposure** | `users` (email/jabatan/role), `clients` (NPWP+kontak), `sites`, `settings.npwp`, `contractValue` dikirim ke **semua** peran | **P0** — kebocoran direktori internal & nilai kontrak |
| SoD | expense & change order ✅; **invoice ❌** | Pembuat invoice bisa jadi penyetuju |
| File access | signed URL HMAC 5 menit + `timingSafeEqual` ✅ | TTL 5 menit + refresh penuh → **klik PDF >5 menit setelah halaman dibuka = 403** |
| Upload | MIME dari klien, base64 ke DB, tanpa antivirus/magic-byte | Malware + DB bloat |
| Header | tanpa CSP/HSTS/`X-Frame-Options` | Klikjacking/XSS tanpa mitigasi |
| Audit | `activity_logs` append-only **secara konvensi**, bukan DB trigger | Bisa diubah lewat SQL langsung; login & akses file tidak diaudit |
| Dependency | 1 critical (`next`), 2 high | Harus dipatch sebelum go-live |

### 2.4 Domain, akuntansi, pajak

Sudah benar: DPP vs PPN dipisah, alokasi diskon proporsional dengan pembulatan ke baris terakhir,
overhead **tidak** masuk biaya proyek, PO = komitmen (bukan biaya), sisa komitmen dihitung
dari PO kumulatif, `retentionOutstanding` dihitung dari nilai kontrak + CO, `closeCheck` 4 syarat,
pembayaran menolak melebihi saldo, PPh dipisah dari kas diterima.

Belum ada / belum benar:
1. **Tanpa pagu anggaran**: RAB tidak menolak/menandai overbudget di server.
2. **Tanpa kontrol kumulatif tagihan** vs nilai kontrak & termin → risiko *over-invoicing*.
3. **Retensi tidak otomatis**: tidak ada pemotongan `retentionPct` saat tagihan progres.
4. **PPN masukan / PPh vendor tidak ada** — hanya sisi pelanggan; tidak ada rekap masa pajak.
5. **Change order**: saat `IMPLEMENTED`, `contractValue` proyek **tidak** diperbarui
   (dua sumber kebenaran: metrik `contractValueCurrent` vs kolom `contractValue`).
6. Kategori biaya CO di-hardcode `cat-civ` untuk semua jenis perubahan.
7. Penomoran `count(*) + tahun` → nomor bolong/tabrakan setelah void atau hapus; tahun pakai UTC.
8. Tidak ada modul HSE/QC/NCR/daily report/material tracking — **wajar** untuk positioning
   "project control", tetapi harus dikomunikasikan agar tidak dinilai sebagai ERP.

### 2.5 Performa & skalabilitas

- SSR snapshot tanpa paginasi; `ORDER BY created_at DESC` tanpa index.
- **0 index FK** → semua join/filter = sequential scan.
- Query kuadratik di `workspace.ts` (nested `filter` di 3 tempat).
- `pg_advisory_xact_lock` global untuk penomoran → serialisasi semua pembuatan expense.
- Payload: ±120 KB HTML untuk 2 proyek & 12 expense. Linear terhadap data → 10 proyek × 2.000
  expense tidak realistis.
- Build/dev berjalan cepat (Turbopack), bundle klien wajar (~1 MB chunk total di build).

---

## 3. Penilaian non-teknis

### 3.1 Positioning & nilai jual

**Yang dijual hari ini (implisit di UI):** "Kendali proyek. Tanpa blind spot." — dan itu jujur:
kekuatan produk ada pada **kendali + auditabilitas**, bukan kelengkapan fitur.

**Risiko positioning:** UI sangat *polished* (animasi, angka besar, grafik) sehingga pembeli
mengasumsikan ERP lengkap. Saat mencoba "buat proyek baru" dan tidak ada tombolnya,
kredibilitas jatuh lebih dalam daripada jika UI-nya sederhana. **Ekspektasi harus dikelola
lewat onboarding & demo script**, bukan hanya lewat UI.

### 3.2 Kesiapan fitur per modul (penilaian "ready to use")

Legenda: ✅ siap · 🟡 siap dengan catatan · 🔴 belum bisa dipakai

| Modul | Status | Yang sudah jalan | Yang menghambat |
|---|---|---|---|
| Login & peran | 🟡 | 6 peran, RBAC per proyek, SoD expense | Akun demo otomatis, tanpa reset password/undang user, tanpa MFA |
| Dashboard portfolio | ✅ | KPI, risiko, pipeline, kartu proyek | Angka bisa menyesatkan bila baseline kosong |
| **Master data (proyek/klien/site/anggota)** | 🔴 | — | **Tidak ada endpoint & UI untuk membuat** |
| **RAB / anggaran** | 🔴 | Lihat, bandingkan, baseline dari seed | Tidak bisa membuat/mengubah versi; tanpa pagu |
| Jadwal & progres | 🟡 | Update progres per item, jejak lapangan | Tidak bisa menambah item/milestone/bobot; tanpa kurva-S |
| Pengadaan (PO) | 🟡 | Buat PO, transisi status, tagih PO | Tanpa approval PO; cancel tetap boleh saat sudah ada tagihan |
| Biaya lapangan | ✅ | 4 langkah, split, OCR, duplikat hash, offline outbox | Tanpa pagu anggaran; OCR hanya `eng`, sinkron & bisa >60 s |
| Approval | ✅ | Inbox dua panel, zoom nota, shortcut A/R/X, override beralasan | Satu level, tanpa delegasi/SLA/notifikasi email |
| Tagihan & pembayaran | 🟡 | State machine, PPh, sisa saldo benar | SoD tidak ada, tanpa kontrol kumulatif, tanpa retensi otomatis |
| Dokumen (11 template) | 🟡 | Snapshot immutable, nomor, revisi, PDF | **Editor blok JSON mentah**; PDF baru diperbaiki (lihat §5) |
| Change order | 🟡 | Ajukan, setujui dengan alasan, implementasi ke baseline baru | Nilai kontrak tidak ikut berubah; kategori hardcoded |
| Serah terima & tutup proyek | 🟡 | Checklist, punch list, 4 syarat close | Checklist tidak terhubung ke dokumen; gate milestone bocor |
| Audit trail | 🟡 | 150 aktivitas terakhir, diff nilai, alasan | Tanpa filter/pencarian, tanpa ekspor, bisa diubah via SQL |
| Pengaturan | 🟡 | Profil PT, PPN default, split nota, kamus biaya | Tidak bisa menambah kategori/satuan/user |
| Ekspor | 🟡 | Excel pengeluaran/tagihan/anggaran | Tidak menghormati permission; tanpa PDF rekap & tanpa jurnal |
| Peluang/CRM | 🔴 | Kartu pipeline read-only | Tanpa CRUD, tanpa proposal, tanpa konversi ke proyek |
| Notifikasi | 🟡 | In-app, 3 pemicu | `readAt` **tidak pernah ditulis** → badge merah selamanya |

**Kesimpulan fitur:** dari 9 menu utama, **1 siap penuh, 7 siap dengan catatan, 2 belum bisa
dipakai** (master data & peluang). Yang paling menipu: modul yang tampak lengkap tetapi
read-only terhadap data seed.

### 3.3 UX / UI

**Kekuatan (nyata, bukan basa-basi):**
- Sistem visual konsisten: `ink #17211c` + `lime #c9f56a` + `paper #f3f4ef`, tipografi tegas,
  kontras teks utama **14,9:1** (WCAG AAA), lime di atas ink **13,2:1**.
- Alur biaya 4 langkah dengan validasi per langkah, upload+OCR, preview dampak anggaran.
- Empty state, toast, badge status berwarna, skeleton/loading state tombol (68 pemakaian).
- Mobile: bottom nav, drawer, seluruh proses bisa diselesaikan dari ponsel (penting untuk site engineer).
- `prefers-reduced-motion` sudah dihormati di `globals.css` **dan** `useReducedMotion()` di dashboard.

**Masalah UX yang menghambat adopsi:**
| # | Masalah | Dampak | Bukti |
|---|---|---|---|
| U1 | **139 teks berukuran 8–10 px** | Tidak terbaca di laptop lapangan & tidak lolos WCAG | §1.3 |
| U2 | A11y minimal: 8 `aria-label` untuk 105 interaksi, **0 `onKeyDown`**, **tanpa Esc & focus-trap di modal** | Pengguna keyboard hanya bisa memakai sebagian | `ui.tsx` Modal |
| U3 | Tanpa routing URL — Back keluar aplikasi, tidak bisa share link "invoice X" | Kolaborasi & training sulit | §2.1 |
| U4 | Notifikasi tidak pernah "dibaca" (badge merah permanen) | Alarm fatigue → diabaikan | `readAt` tanpa penulis |
| U5 | `window.prompt` untuk alasan admin & pembatalan invoice | Tidak bisa diaudit rapi di mobile, tidak konsisten | 3 pemakaian |
| U6 | Aksi destruktif tanpa konfirmasi modal standar | Salah klik = data berubah | tombol VOID/CANCEL |
| U7 | Tanpa pencarian/filter global lintas modul (search hanya proyek/biaya/invoice, 10 hasil) | Data lama sulit ditemukan | `EPCApp` search |
| U8 | Link unduh PDF kedaluwarsa 5 menit | "Klik PDF gagal" setelah membaca lama | `workspace.ts` `expires` |
| U9 | Aset hero 404 di login & dashboard | Kesan pertama "belum selesai" | uji #18 |
| U10 | Tanpa `error.tsx`/`loading.tsx` → error SSR = layar putih bawaan Next | Saat DB putus, pengguna tidak tahu apa yang terjadi | `src/app` |

### 3.4 Kesiapan operasional & organisasi

| Aspek | Kondisi | Kebutuhan minimum |
|---|---|---|
| Observability | hanya `console.error` | Sentry + request-id + metrik (p95 API, error rate) |
| Backup/DR | tidak ada dokumentasi, RPO/RTO tidak didefinisikan | backup harian + **uji restore** tercatat |
| Uptime | tanpa health monitoring eksternal (endpoint `/api/health` ada) | uptime check + alert |
| Kepatuhan UU PDP | belum ada privacy notice, retensi, hak hapus | kebijakan + DPA + retensi data |
| Multi-tenant | satu `companySettings`, tanpa `tenant_id` | hanya bila menuju SaaS |
| Onboarding | README minim, tanpa runbook, tanpa dokumentasi API | runbook + panduan per peran + video 5 menit |
| Dukungan | tanpa jalur eskalasi/help | kanal dukungan + SLA internal |

### 3.5 Skor per dimensi (1–5)

| Dimensi | Skor | Alasan |
|---|---:|---|
| Kejelasan produk & positioning | 4,0 | Alur & kosakata domain akurat dan konsisten |
| Kedalaman domain EPC | 3,5 | Rantai biaya–komitmen–tagihan–BAST kuat; engineering/HSE/QC absen |
| Kontrol internal & auditabilitas | 3,5 | Stage gate, SoD, baseline immutable; ada celah eksekusi (invoice, gate milestone) |
| Keamanan aplikasi | 2,5 | Fondasi baik, eksekusi belum production-grade (auto-seed, kebocoran data) |
| Kualitas kode & maintainability | 2,0 | 0 test, lint gagal, 124 baris >400 karakter |
| Skalabilitas & performa | 2,0 | Snapshot SSR, tanpa index, query kuadratik |
| UX / UI | 3,5 | Visual kuat & konsisten; tipografi terlalu kecil, a11y lemah, tanpa routing |
| Kesiapan operasional | 1,5 | Tanpa observability, DR, SSO, dokumentasi |
| **Kesiapan produksi keseluruhan** | **2,5** | **Demo-grade / pilot-ready** |

---

## 4. Daftar fitur yang **belum ada** (gap produk)

**Blocker (tanpa ini produk tidak bisa dipakai untuk proyek baru)**
1. CRUD proyek (wizard: klien → site → kontrak → PM → anggota → termin → baseline).
2. CRUD klien & site (dengan NPWP dan kontak).
3. CRUD anggota proyek & peran per proyek.
4. Editor RAB versi (client & internal), penetapan baseline, approval versi.
5. CRUD item jadwal + bobot + milestone; template WBS dari proyek sebelumnya.
6. CRUD termin kontrak (DP/termin/progres/retensi/BAST).
7. Manajemen pengguna: undang, nonaktifkan, reset password, peran.
8. Notifikasi eksternal (email/WA) + status baca.

**Penting untuk kendali (bukan blocker, tapi cepat terasa)**
9. Validasi pagu anggaran di server + alur approval overbudget.
10. Kontrol tagihan kumulatif vs kontrak & termin.
11. Pemotongan retensi otomatis pada tagihan.
12. SoD invoice + approval multi-level dengan ambang nilai.
13. Approval PO (saat ini PROCUREMENT bisa langsung `ORDERED`).
14. Rekap pajak masa (PPN keluaran/masukan, PPh 4(2)/23) + ekspor.
15. Filter/pencarian server + paginasi + bulk approve.
16. Ekspor audit trail (CSV/XLSX) dan laporan progres berkala.

**Nilai tambah / diferensiasi**
17. Portal klien/MK (read-only: progres, tagihan, dokumen).
18. Portal vendor (PO, tagihan, status pembayaran).
19. Kurva-S rencana vs aktual, EVM ringan (SPI/CPI).
20. Foto lapangan bergeotag + daily report singkat.
21. Tanda tangan elektronik pada BAST (bukan sekadar gambar garis).
22. Struktur multi-tenant (`tenant_id` + RLS) bila menuju SaaS.

---

## 5. Perbaikan yang **sudah** dikerjakan pada sesi ini

Commit `cb0bce3` (di branch `arena/e519a823-...`, sudah diverifikasi dengan PDF nyata):

1. **`src/lib/pdf.ts` — dokumen legal tidak lagi kehilangan data.**
   Sebelum: setiap string dipotong 110 karakter dan semua karakter non-ASCII → `-`, tabel
   ditumpuk tanpa kolom. Sesudah: pembungkusan teks berbasis `widthOfTextAtSize` (tanpa potong),
   peta simbol (`×`, `—`, kutip, elipsis), tabel dengan grid & pembungkusan per sel, baris tabel
   sadar page-break, blok tanda tangan dua kolom yang rapi.
2. **`src/app/api/documents/route.ts` — nominal tidak lagi tampak negatif.**
   Snapshot menyimpan `Rp\u00A04.850.000.000` sehingga PDF mencetak **`Rp 4.850.000.000`**,
   bukan `Rp-4.850.000.000` lagi.
3. **`src/db/index.ts` — aplikasi tidak lagi mati saat koneksi DB terputus.**
   Pool `pg` sekarang punya listener `error` (tanpa itu satu koneksi putus =
   `uncaughtException` → proses keluar), plus `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`
   yang bisa dikonfigurasi lewat env.

Sisa pekerjaan ada di brief berikut.

---

## 6. Brief rencana upgrade

### 6.1 Prinsip

1. **Kendali dulu, fitur kemudian.** Setiap rupiah harus punya jejak; jangan menambah modul
   sebelum pagar-pagar yang ada benar-benar ditegakkan di server.
2. **Satu sumber kebenaran.** Kalau angka ada di metrik turunan, kolom aslinya harus ikut
   diperbarui (atau dihapus) — bukan dua-duanya.
3. **Uji dulu untuk logika uang.** `finance.ts` & `domain.ts` wajib punya unit test sebelum
   refactor apa pun.
4. **Jangan mengejar ERP.** Tolak permintaan modul baru yang tidak memperkuat rantai
   `biaya → komitmen → tagihan → BAST → tutup`.

### 6.2 Roadmap 3 gelombang

#### Wave 0 — "Aman & terpercaya" (0–2 minggu, 1 engineer) → syarat minimum menyentuh data klien

| Paket | Isi | Kriteria selesai |
|---|---|---|
| W0.1 Hentikan seed di produksi | Seed hanya lewat CLI berflag (`npm run seed:demo`), hapus fallback password hardcoded, wajib `SEED_DEMO_PASSWORD` ≥16 karakter, audit akun yang sudah ada | Boot produksi tanpa akun demo; test memastikan `/api/auth/login` tidak memanggil seed |
| W0.2 Tutup kebocoran data | Proyeksi DTO per permission: `users` hanya `{id,name}` untuk non-admin; `clients/sites` hanya pihak relevan; `settings.npwp` hanya ADMIN/FINANCE; `contractValue` dihapus dari objek proyek bila tanpa `budget.client.view` | Matriks 6 role × 12 field teruji otomatis |
| W0.3 Patch keamanan | Upgrade `next`/`postcss`/`sharp`; header CSP, HSTS, `X-Frame-Options`, `Referrer-Policy` di `next.config.ts`; rate limit login ke tabel/Redis | `npm audit` produksi 0 critical/high; scanner header lulus |
| W0.4 Selaraskan izin & ekspor | Ekspor menghormati permission (403, bukan file kosong); `clientUuid` idempotensi difilter `createdById`; `requireSeparationOfDuty` benar-benar dipakai | Test lintas pengguna & 6 role × endpoint lulus |
| W0.5 Jaring pengaman engineer | Vitest + test untuk `finance.ts`/`format.ts`/`domain.ts`; perbaiki 7 lint error; build tanpa `DATABASE_URL` (init DB lazy); CI: typecheck + lint + test + audit | CI hijau, coverage `finance.ts` > 80 % |
| W0.6 Fondasi UX | `error.tsx`, `loading.tsx`, `not-found.tsx`; minimal 12 px untuk teks isi; Esc + focus-trap di modal; tombol aksi destruktif pakai modal alasan; aset hero & favicon | Lighthouse 404 = 0; audit tipografi & keyboard lulus |

**Gate W0:** pilot internal dengan 1 proyek data *asli* (bukan seed) diperbolehkan.

#### Wave 1 — "Bisa dipakai proyek baru" (3–6 minggu, 1–2 engineer) → siap pilot klien

| Paket | Isi | Kriteria selesai |
|---|---|---|
| W1.1 Master data & wizard proyek | CRUD proyek/klien/site/anggota + wizard 5 langkah (klien → kontrak → PM → anggota → baseline awal) + audit tiap langkah | Proyek baru dari nol selesai < 15 menit oleh PM tanpa bantuan developer |
| W1.2 RAB, termin, jadwal | Editor RAB (client/internal) berversi + penetapan baseline + approval; CRUD termin; CRUD item jadwal dengan bobot | Tidak ada lagi ketergantungan pada data seed; bobot jadwal selalu 100 % |
| W1.3 Pagar anggaran & penagihan | Validasi server: overbudget butuh alasan + approval PM; kumulatif tagihan ≤ kontrak/termin; retensi otomatis; CO meng-update `contractValue` | Uji skenario 110 % kontrak ditolak; overbudget tercatat di audit |
| W1.4 Persetujuan berjenjang | Matriks approval (ambang nilai, delegasi, SLA, eskalasi) + SoD untuk **invoice** & **PO** | Test SoD invoice & PO; uji ambang nilai |
| W1.5 Performa & navigasi | Paginasi/filter server + agregasi SQL (hilangkan query kuadratik) + index FK & komposit; routing URL (`/projects/[id]/invoices/[id]`) + `error`/`loading` per segmen; signed URL dibuat saat klik | Payload awal < 1 MB; p95 render < 2 s pada 10 ribu expense; link bisa dibagikan |
| W1.6 Dokumen yang bisa dipakai PM | Editor blok visual (bukan JSON mentah), template bisa disunting & diberi versi, nomor per proyek + timezone Jakarta, unggah PDF ke object storage | PM bisa membuat BAST 1 tanpa bantuan teknis; uji cetak identik |
| W1.7 Notifikasi & kolaborasi | Status baca (`readAt`), email/WA untuk approval & jatuh tempo, filter "milik saya" | Notifikasi terkirim < 1 menit; badge benar-benar hilang setelah dibaca |

**Gate W1:** pilot 2–3 proyek nyata, nilai kecil, dengan UAT per peran dan runbook.

#### Wave 2 — "Siap operasional & komersial" (7–12 minggu)

| Paket | Isi |
|---|---|
| W2.1 Pajak & keuangan | Faktur pajak, PPN masukan, PPh vendor, rekap masa + ekspor, jurnal sederhana |
| W2.2 Laporan & analitik | Kurva-S, EVM ringan (SPI/CPI), laporan progres berkala otomatis, dashboard margin per proyek |
| W2.3 Operasional | Observability (Sentry + metrik + alert), backup + **uji restore** tercatat (RPO 24 jam / RTO 4 jam), runbook & dokumentasi API |
| W2.4 Kepatuhan | Kebijakan privasi (UU PDP), retensi & hak hapus, DPA dengan klien, audit akses file |
| W2.5 Portal eksternal | Portal klien/MK (read-only) & vendor (PO/tagihan) dengan token terbatas |
| W2.6 Skala | Object storage + presigned upload (keluar dari base64 di DB), OCR async worker, multi-tenant `tenant_id` + RLS (hanya jika menuju SaaS) |

### 6.3 Prioritas ringkas (MoSCoW)

- **Must (sebelum proyek klien):** W0.1–W0.6, W1.1, W1.3, W1.4 (SoD invoice), W1.5 (index + payload).
- **Should:** W1.2, W1.6, W1.7, W2.1, W2.3.
- **Could:** W2.2, W2.5, kurva-S.
- **Won't (tahun ini):** HSE/QC/NCR penuh, material tracking gudang, multi-currency mendalam,
  SSO enterprise — kecuali ada klien yang membayar untuk itu.

### 6.4 Estimasi

| Gelombang | Durasi | Tim | Hasil |
|---|---|---|---|
| W0 | 2 minggu | 1 BE + 1 FE (paruh) | Aman untuk data internal |
| W1 | 4–6 minggu | 2 engineer + QA paruh | Pilot klien |
| W2 | 6–8 minggu | 2 engineer + 1 ops | Produksi operasional |
| **Total** | **±12–16 minggu** | | **Production-ready** untuk 3–10 proyek aktif |

### 6.5 Definisi "production ready" (checklist go-live)

- [ ] Tidak ada akun/seed demo di produksi; semua user diundang & password dirotasi
- [ ] Matriks role × field teruji otomatis (tidak ada NPWP/nilai kontrak bocor)
- [ ] Proyek baru bisa dibuat end-to-end oleh PM tanpa developer
- [ ] Overbudget & over-invoice ditolak atau butuh approval khusus
- [ ] SoD berlaku untuk expense, invoice, PO, change order
- [ ] `npm audit` produksi 0 critical/high; header keamanan aktif
- [ ] CI hijau: typecheck + lint + unit test + integration test otorisasi
- [ ] Migrasi DB berversi & diuji rollback
- [ ] Backup harian + uji restore terdokumentasi
- [ ] Sentry + alert error rate & latency aktif
- [ ] Runbook insiden + panduan per peran + video onboarding
- [ ] Kebijakan privasi & retensi data disetujui

### 6.6 Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Refactor besar-besaran sekaligus | Regresi diam-diam pada rumus uang | Test `finance.ts` lebih dulu; refactor per modul + feature flag |
| Master data dibangun tanpa validasi domain expert | Skema RAB/termin tidak sesuai praktik | Workshop 1 hari dengan PM/QS; UAT per gelombang |
| Menambah modul (HSE/QC) karena permintaan klien | Fokus & anggaran pecah | Tolak dengan kriteria MoSCoW; tawarkan portal/integrasi |
| OCR & upload tetap di DB | Biaya DB membengkak | Pindah ke object storage di W2, sementara batasi kuota |
| Data demo terlanjur dipakai di proyek nyata | Keputusan berbasis angka contoh | Label "DEMO DATA" di UI + larangan pembuatan proyek baru sebelum W1.1 |

---

## 7. Lampiran

### 7.1 Inventaris route API (24)

`auth/login`, `auth/logout`, `change-orders`, `change-orders/[id]/action`, `documents`,
`documents/[id]`, `documents/[id]/action`, `expenses`, `expenses/[id]`, `expenses/[id]/action`,
`expenses/[id]/settlements`, `export/[type]`, `files`, `files/[id]`, `health`, `invoices`,
`invoices/[id]/action`, `invoices/[id]/payments`, `ocr`, `projects/[id]/action`, `purchases`,
`purchases/[id]/action`, `schedule/[id]/progress`, `settings`.

**Tidak ada** route untuk `projects` (create), `clients`, `sites`, `members`, `budgets`,
`contract-terms`, `schedule` (create), `opportunities`, `users`.

### 7.2 Permission yang tidak ditegakkan (6 dari 40)

`template.manage`, `users.manage`, `proposal.edit`, `proposal.approve`, `budget.edit`, `design.edit`
— artinya menu/aksi terkait tidak ada, sehingga peran ESTIMATOR & PM terlihat punya hak yang
tidak bisa dipakai.

### 7.3 Cara mereproduksi pemeriksaan

```bash
npm ci
npm run typecheck        # lulus
npm run lint             # 7 error, 2 warning
npx next build           # gagal tanpa DATABASE_URL
npm audit                # 1 critical, 2 high
# jalankan dengan Postgres, lalu:
#   curl -X POST /api/auth/login (pm@ardaya.id)
#   curl /                        → 120 KB HTML berisi email & NPWP seluruh user
#   curl -X POST /api/invoices/<id>/action {APPROVE}  → pembuat menyetujui sendiri
```

### 7.4 Asumsi & batasan

- Analisis dilakukan pada commit `67c1e30` (setelah `cb0bce3` menerapkan perbaikan §5).
- Database uji adalah PostgreSQL 18 (WASM) dengan skema yang sama; perilaku Neon dapat berbeda
  pada pooling, tetapi temuan kode tidak bergantung pada itu.
- Uji UI dilakukan lewat HTML/HTTP dan telaah komponen, **bukan** observasi visual di browser
  berjalan (tidak ada browser di lingkungan ini); temuan a11y/visual dikuantifikasi dari kode.
- Tidak ada akses ke deployment produksi atau data operasional Ardaya.
