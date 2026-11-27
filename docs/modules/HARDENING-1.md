# Hardening tahap 1 — guard transaksi & isolasi notifikasi

*Dikerjakan 2026-11-17, setelah S1 + S2a + S2b + S3 (PR #13–#16) merged. Bukan sprint baru:
ini penutupan temuan audit yang tersisa dan berisiko nyata, tanpa mengubah model data bisnis.*

| # | Temuan audit | Perilaku sebelumnya | Perilaku sekarang |
|---|---|---|---|
| DOM-08 | PO bisa dibatalkan setelah ada tagihan | Komitmen PO bisa hilang dari metrik | `CANCELLED` ditolak `409 PO_HAS_BILLS` bila ada `PO_BILL` aktif |
| DOM-07 | Invoice bisa disetujui pembuatnya sendiri | Salah saji approval tagihan | `APPROVE` ditolak `403 SEPARATION_OF_DUTY` (ADMIN tetap override) |
| SEC-05 | Ekspor fail-open (200 + file kosong) | Permission bocor tanpa sinyal | Semua jenis ekspor punya izin eksplisit; tanpa izin = `403` |
| B9 (lanjutan) | Ekspor `budget` bisa memuat RAB INTERNAL | Margin internal bisa terekspor | Ekspor RAB difilter `budget.internal.view` |
| UX-04 | `notifications.read_at` tidak pernah ditulis | Badge merah permanen | Endpoint `POST /api/notifications/read` + UI "Tandai semua dibaca" |
| — | Notifikasi company lain/user lain ikut terkirim | Kebocoran antar pengguna | Policy **RESTRICTIVE** `notifications_owner_select/update` (0005) |
| — | Warning build `middleware` deprecated | Noise build | `src/middleware.ts` → `src/proxy.ts` (konvensi Next 16) |

## 1. Migrasi `0005_hardening_invoice_notifications.sql`

Forward-only, tanpa down script, non-destruktif.

1. `customer_invoices.created_by_id` (`text`, FK `users(id) ON DELETE SET NULL`) + index
   `(company_id, created_by_id)`.
2. **Backfill** dari `activity_logs` (`object_type='INVOICE'`, prioritas aksi `CREATED`,
   lalu yang paling awal). Invoice lama tanpa jejak audit tetap `NULL` → aturan SoD
   hanya berlaku bila pembuatnya diketahui (tidak ada klaim palsu).
3. `app_current_user_id()` = `NULLIF(current_setting('app.current_user_id', true), '')`.
4. Dua policy **RESTRICTIVE** pada `notifications` (SELECT + UPDATE) dengan
   `user_id = app_current_user_id()`. INSERT sengaja **tidak** dibatasi: notifikasi untuk
   approver dibuat oleh pengaju (pola modul expense).
   - RESTRICTIVE = digabung **AND** dengan policy company, jadi tidak bisa menambah akses.
   - Tanpa GUC → 0 baris (fail-closed).

Setelah 0005: **30 tabel FORCE RLS**, **124 policy** = 120 isolasi company
+ 2 RESTRICTIVE RAB internal (0002) + 2 RESTRICTIVE notifikasi (0005).

`withCompany()` kini melakukan tiga `SET LOCAL` dalam transaksi yang sama:
`app.current_company_id`, `app.current_permissions`, `app.current_user_id`.

## 2. Guard PO (`evaluatePoCancelGuard`)

Fungsi murni di `src/modules/procurement/types.ts`, dipakai
`assertPoCancellable()` (`src/modules/procurement/service.ts`) pada
`POST /api/purchases/[id]/action`.

- Tagihan dianggap **aktif** bila `approvalStatus` bukan `VOIDED`/`REJECTED`.
- Hanya memblokir transisi **ke** `CANCELLED`; transisi lain tidak berubah.
- Pesan menyebut jumlah tagihan aktif dan menyarankan void/cancel tagihan dulu.
- Bukan trigger DB: keputusan sadar agar pesan bisa jelas dan agar data lama yang sudah
  tidak konsisten tidak membuat migrasi gagal. Jalur UI tetap satu service.

## 3. Pemisahan tugas invoice (`assertInvoiceSeparationOfDuty`)

- Berlaku untuk aksi `APPROVE`; `SEND`/`CANCEL` tidak terpengaruh.
- ADMIN dikecualikan (override terakhir, sama seperti `expenses`, `change orders`, `budgeting`).
- `createdById` NULL (invoice pra-0005 tanpa audit) → aturan dilewati, bukan memblokir.

## 4. Ekspor (`src/lib/export-permissions.ts`)

| Jenis | Izin yang diterima | Catatan |
|---|---|---|
| `expenses` | `expense.view.project` **atau** `expense.view.own` | FIELD tetap bisa ekspor biayanya sendiri |
| `invoices` | `invoice.view` | FIELD/PROCUREMENT → 403 |
| `budget` | `budget.client.view` **atau** `budget.internal.view` | INTERNAL hanya bila punya izin internal |

Jenis tidak dikenal → `404 UNKNOWN_EXPORT`. Fungsi murni ini diuji di
`tests/unit/rbac.test.ts` tanpa DB.

## 5. Notifikasi

- `POST /api/notifications/read` body `{ "all": true }` atau `{ "ids": ["..."] }` (maks 200).
- Hanya menulis `read_at` untuk `user_id = sesi`; policy RESTRICTIVE menjaga di DB.
- UI: tombol **Tandai semua dibaca**, titik merah per item, judul tebal hanya bila belum dibaca,
  klik item menandai dibaca lalu navigasi.
- GUC `app.current_user_id` wajib ada. Script SQL manual tanpa GUC **tidak akan melihat
  notifikasi apa pun** — ini disengaja (fail-closed), sama seperti RAB internal.

## 6. `middleware` → `proxy`

Next.js 16.4 menandai konvensi `middleware.ts` deprecated. File dipindah ke
`src/proxy.ts` dengan export `proxy()`; matcher tetap `["/api/:path*"]`, logika
CSRF/Origin/cookie tidak berubah. Warning build hilang.

## 7. Verifikasi

```bash
npm ci --no-audit --no-fund
npm run typecheck && npm run lint && npm test
env -u DATABASE_URL -u FILE_SIGNING_SECRET npm run build   # tanpa warning middleware
npm audit --omit=dev --audit-level=high
```

- `tests/unit/migrations.test.ts` — **30 test** PGlite `0000 → 0005`
  (termasuk backfill `created_by_id`, isolasi notifikasi per user, fail-closed tanpa GUC).
- `tests/unit/procurement.test.ts` — guard PO + SoD invoice.
- `tests/unit/rbac.test.ts` — matriks izin ekspor + filter RAB INTERNAL.
- `npm run db:verify` menambah 2 pemeriksaan: `created_by_id` ada, 2 policy RESTRICTIVE notifikasi.

**Belum diverifikasi**: `npm run db:migrate` ke database nyata (sandbox tanpa kredensial).
0005 wajib dijalankan manual setelah backup: `db:migrate -- --check` → `db:migrate` → `db:verify`.

## 8. Yang sengaja TIDAK dikerjakan di tahap ini

- Trigger DB untuk larangan cancel PO / self-approve invoice (butuh backfill data lama lebih dulu).
- Audit akses file (`GET /api/files/[id]`) dan ekspor audit trail.
- `window.prompt` → modal inline (UX-02).
- Master data CRUD proyek/klien/site/anggota, S4 Document Generator, S5 kurva-S, S6.
