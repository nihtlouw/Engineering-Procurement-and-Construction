# Autentikasi: apa yang sudah layak, apa yang belum

Dokumen ini menjawab satu pertanyaan: **apakah auth aplikasi ini layak dipakai
untuk data klien?** Jawabannya: sebagian besar ya, dengan satu prasyarat wajib
dan beberapa batasan yang harus diketahui, bukan disembunyikan.

Semua angka di sini **diukur** di mesin build (Node 22, scrypt Node `crypto`),
bukan disalin dari dokumentasi.

## Prasyarat wajib (belum terpenuhi di database saat ini)

Migrasi `0010_login_lockout.sql` belum diterapkan. Kode membaca
`failed_login_count`/`locked_until`, sehingga login gagal dengan
`column "failed_login_count" does not exist`. **Tidak ada perbaikan auth yang
berguna sebelum migrasi dijalankan.**

## Yang sudah benar

| Aspek | Keadaan |
|---|---|
| Penyimpanan password | scrypt (memory-hard), salt acak per hash, perbandingan `timingSafeEqual` |
| Sesi | tabel `sessions`, cookie `httpOnly` + `sameSite=lax` + `secure` di production |
| Batas sesi | idle 30 menit (`lastSeenAt`) + absolut 12 jam (`expiresAt`) |
| Rotasi | login baru menghapus seluruh sesi lama pengguna |
| Kunci akun | 10 gagal → 15 menit, 20 gagal → 60 menit, penghitung di DB (bukan memori instance) |
| Rate limit | berbasis tabel `auth_events`, sehingga tidak hilang saat instance serverless didaur |
| Kebocoran akun | pesan seragam + **waktu respons seragam** (lihat di bawah) |
| Reset password | token sekali pakai, hanya hash token disimpan, TTL 30 menit, semua sesi dicabut |
| Otorisasi | peran dari `memberships` (bukan `users.role`), RLS per company, `SET LOCAL` per transaksi |
| CSRF | `sec-fetch-site` + pemeriksaan Origin untuk **semua** mutasi, termasuk route publik |
| Header | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy |

## Perbaikan pada putaran ini

### 1. `scryptSync` memblokir event loop — terukur, bukan teori

Satu verifikasi 41–88 ms. Ukuran langsung dengan timer 10 ms:

| Cara | 8 verifikasi paralel | Tick timer selama kerja |
|---|---|---|
| `scryptSync` | 325 ms | **0** (event loop berhenti total) |
| `scrypt` async | 191 ms | 18 |

Artinya 8 permintaan login bersamaan (batas rate limit per akun) membekukan
seluruh instance: pengguna lain tidak dilayani sama sekali. Penyerang tidak butuh
satu pun password benar untuk memperlambat aplikasi. Sekarang seluruh jalur
request memakai `scrypt` async; `scryptSync` hanya tersisa di skrip CLI.

### 2. Parameter scrypt dinaikkan, dan bisa dinaikkan lagi

| | Sebelum | Sesudah |
|---|---|---|
| N (work factor) | 16384 | **32768** |
| Waktu verifikasi | ~41 ms | ~88 ms |
| Format hash | `salt:hash` (161 char) | `scrypt$N=32768,r=8,p=1$salt$hash` (184 char) |

Format lama tidak menyimpan parameternya, sehingga parameter **tidak mungkin**
dinaikkan tanpa mengunci semua akun. Format baru menyimpannya. Hash lama tetap
diverifikasi dan **otomatis di-rehash saat login berhasil** (`needsRehash`) —
satu-satunya saat password tersedia dalam bentuk terbaca.

N=32768 dipilih dari pengukuran, bukan anjuran OWASP (2^17). Pada 2^17 biaya per
login ~350 ms; untuk serverless itu lebih berisiko (kehabisan waktu/CPU) daripada
manfaatnya. **Angka ini harus ditinjau ulang bila ada data produksi.**

### 3. Enumerasi akun lewat waktu respons

Pesan error sudah seragam, tetapi waktunya tidak: "email tidak terdaftar"
kembali ~0 ms, "email ada" ~88 ms. Selisih itu cukup untuk memetakan email mana
yang terdaftar. Sekarang jalur "akun tidak ada" tetap menjalankan scrypt terhadap
hash tiruan, sehingga kedua jalur memakan waktu yang sama.

### 4. Aturan password di semua jalur pembuatan

| Jalur | Sebelum | Sesudah |
|---|---|---|
| Undangan (`/accept-invite`) | 8 karakter, tanpa campuran | 12 + huruf besar/kecil + angka |
| Reset oleh admin | 12 + campuran | sama |
| Ganti sendiri | 12 + campuran | sama |

Sebelumnya pengguna baru bisa masuk lewat undangan dengan `rahasia123`, dan
batas itu tidak pernah naik lagi setelah akun dibuat.

### 5. CSRF pada route publik

Pemeriksaan Origin/`sec-fetch-site` berada setelah `return` untuk route publik,
sehingga `POST /api/auth/login` lintas situs diterima (login CSRF: korban masuk
ke akun penyerang lalu mengunggah data ke tenant yang salah). Sekarang
pemeriksaan berjalan untuk semua mutasi.

## Batasan yang MASIH ada (jangan diklaim selesai)

1. **Belum ada MFA/TOTP.** Untuk akun ADMIN yang memegang data keuangan, ini
   celah terbesar yang tersisa. Password saja = satu faktor.
2. **Belum ada perlindungan permintaan pemulihan MFA** (kalau nanti ditambah).
3. **Rate limit login berbasis email, bukan IP.** Penyerang dengan banyak email
   dapat menyebar percobaan; sebaliknya satu IP jahat tidak dibatasi khusus.
4. **CSP masih `script-src 'unsafe-inline'`** karena Next.js menyuntikkan
   bootstrap inline. Nonce-based CSP belum dikerjakan.
5. **Tidak ada notifikasi login baru** (email "ada login dari perangkat baru").
   Deteksi penyalahgunaan masih bergantung pada melihat `auth_events` manual.
6. **`activity_logs` append-only masih konvensi**, belum ditegakkan trigger DB.
7. **Tidak ada pembersihan `auth_events`/`sessions` kedaluwarsa** — tabel akan
   tumbuh tanpa batas. Perlu job periodik (atau `pg_cron`).
8. **Sesi tidak disimpan sebagai hash** — id sesi ada di DB apa adanya. Bocornya
   dump database = sesi aktif dapat dipakai. Mitigasi: TTL pendek (idle 30 menit).

## Urutan yang disarankan berikutnya

1. Jalankan migrasi `0010` + `0011` (prasyarat semua di atas).
2. Bersihkan akun demo: `npm run db:set-passwords -- --only-demo` lalu nonaktifkan.
3. MFA untuk peran ADMIN (TOTP) — dampak terbesar per usaha.
4. Job pembersihan `auth_events`, `sessions`, `password_reset_tokens`.
5. Nonce-based CSP.
