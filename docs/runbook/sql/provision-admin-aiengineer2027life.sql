-- Dihasilkan oleh `npm run db:admin-sql` — SQL siap tempel ke SQL Editor Neon.
-- Email admin : aiengineer2027life@gmail.com
-- Company     : Ardaya EPC (ardaya-epc)
-- Akun demo   : 6 akun @ardaya.id diberi password "ArdayaDemo2026"
-- Jalankan SELURUH berkas ini sekaligus (satu transaksi).

begin;

-- Company HANYA dibuat bila belum ada satu pun. Membuat company baru saat
-- data sudah ada akan menghasilkan tenant kosong: proyek & user lama tidak
-- terlihat karena berada di company lain.
insert into companies (slug, name, legal_name, email)
select 'ardaya-epc', 'Ardaya EPC', 'Ardaya EPC', 'aiengineer2027life@gmail.com'
 where not exists (select 1 from companies);

insert into users (id, name, email, role, title, password_hash)
values (
  'usr-admin-owner',
  'Admin Pemilik',
  'aiengineer2027life@gmail.com',
  'ADMIN',
  'Admin Perusahaan',
  'd98a590e31a72dc76972c2d9ce632af5:05cf8094a7d7bdd474fec717aa8850cb6938ae61bf932d6933629350d91a5c1535b3bf3c7087201d44ab122c983f6cab068734e34955b3ea3d0745e4a97d725e'
)
on conflict (email) do update
  set password_hash = excluded.password_hash,
      is_active = true;

-- Keanggotaan ditempelkan ke company YANG SUDAH ADA (yang tertua = tenant
-- sebenarnya tempat proyek & data tersimpan), bukan ke company baru.
insert into memberships (company_id, user_id, company_role, status)
select c.id, u.id, 'ADMIN', 'ACTIVE'
  from (select id from companies order by created_at, id limit 1) c, users u
 where u.email = 'aiengineer2027life@gmail.com'
on conflict (company_id, user_id) do update
  set company_role = 'ADMIN', status = 'ACTIVE', updated_at = now();

update users
   set password_hash = 'ce8e1395bd128f0db66ff64b1169b18a:70ad6301a9a0e2c548850f210bb1e3223ab4ea94911989d982dd1804b5c3cf440956fa7a2cc232b334dd3fb9fa7e4e3b0d8f9a5fdb88929058e5834296e90078'
 where email in ('admin@ardaya.id','estimator@ardaya.id','field@ardaya.id',
                 'finance@ardaya.id','pm@ardaya.id','procurement@ardaya.id');

commit;

-- Verifikasi: satu baris, role ADMIN, panjang_hash = 161.
select u.email, u.role, length(u.password_hash) as panjang_hash, m.company_role, m.status
  from users u
  join memberships m on m.user_id = u.id
 where u.email = 'aiengineer2027life@gmail.com';

-- Template lengkap (dengan komentar) ada di docs/runbook/sql/provision-admin.sql.
