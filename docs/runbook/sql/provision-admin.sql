-- ============================================================================
-- Provisioning akun ADMIN lewat SQL murni (SQL Editor Neon / psql).
--
-- Kenapa ada berkas ini: perintah `npm run …` adalah perintah TERMINAL, tidak
-- dapat dijalankan di SQL Editor. Berkas ini adalah padanan SQL-nya sehingga
-- akun admin dapat dibuat tanpa akses ke folder repo.
--
-- Cara pakai:
--   1. Ganti __EMAIL__, __NAME__, __COMPANY__, __SLUG__ sesuai kebutuhan
--      (atau jalankan: npm run db:admin-sql -- --email ... --name "..." >
--       admin.sql, lalu tempel isinya).
--   2. Ganti __HASH__ dengan hash dari `npm run db:hash-password`. JANGAN
--      mengetik password biasa — kolom ini berisi `salt:hash` scrypt 161 char.
--   3. Jalankan seluruh berkas sekaligus (satu transaksi).
--
-- Aman dijalankan berulang: semua insert memakai ON CONFLICT dan UPDATE bersifat
-- idempoten.
--
-- Dua varian skema didukung:
-- - **tanpa kolom 0010** (`failed_login_count`, `locked_until` belum ada) →
--   pakai berkas ini apa adanya;
-- - **dengan kolom 0010** → tambahkan `, failed_login_count = 0, locked_until = null`
--   pada blok UPDATE password (opsional, hanya merapikan status kunci).
-- ============================================================================

begin;

-- 1) Company. HANYA dibuat bila belum ada satu pun — membuat company baru saat
--    data sudah ada menghasilkan tenant kosong (proyek lama tidak terlihat).
insert into companies (slug, name, legal_name, email)
select '__SLUG__', '__COMPANY__', '__COMPANY__', '__EMAIL__'
 where not exists (select 1 from companies);

-- 2) Akun admin. `users.id` bertipe text tanpa default → diisi eksplisit.
--    Skema yang dipakai HANYA kolom yang ada di tabel `users` hasil instalasi
--    awal; kolom `0010` sengaja tidak disertakan agar skrip ini tidak gagal
--    sebelum migrasi 0010 diterapkan.
insert into users (id, name, email, role, title, password_hash)
values (
  'usr-admin-owner',
  '__NAME__',
  '__EMAIL__',
  'ADMIN',
  'Admin Perusahaan',
  '__HASH__'
)
on conflict (email) do update
  set password_hash = excluded.password_hash,
      is_active = true;

-- 3) Keanggotaan ADMIN ditempelkan ke company YANG SUDAH ADA (yang tertua =
--    tenant sebenarnya tempat proyek & data tersimpan), bukan ke company baru.
insert into memberships (company_id, user_id, company_role, status)
select c.id, u.id, 'ADMIN', 'ACTIVE'
  from (select id from companies order by created_at, id limit 1) c, users u
 where u.email = '__EMAIL__'
on conflict (company_id, user_id) do update
  set company_role = 'ADMIN', status = 'ACTIVE', updated_at = now();

-- 4) Ganti hash untuk akun demo lama (opsional, hapus blok ini bila tidak perlu).
--    Semua akun demo berbagi SATU hash — artinya satu kebocoran membuka semuanya.
--    Blok ini memberi mereka satu password acak yang diketahui tim, sehingga
--    akun lama tidak lagi memakai password bersama yang tidak diketahui siapa pun.
update users
   set password_hash = '__DEMO_HASH__'
 where email in ('admin@ardaya.id','estimator@ardaya.id','field@ardaya.id',
                 'finance@ardaya.id','pm@ardaya.id','procurement@ardaya.id');

commit;

-- 5) Verifikasi: satu baris, role ADMIN, panjang_hash = 161.
select u.email, u.role, length(u.password_hash) as panjang_hash, m.company_role, m.status
  from users u
  join memberships m on m.user_id = u.id
 where u.email = '__EMAIL__';
