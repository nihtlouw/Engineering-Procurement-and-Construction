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
-- Aman dijalankan berulang: semua insert memakai ON CONFLICT.
-- ============================================================================

begin;

-- 1) Company. Bila slug sudah ada, tidak ada yang dibuat.
insert into companies (slug, name, legal_name, email)
values ('__SLUG__', '__COMPANY__', '__COMPANY__', '__EMAIL__')
on conflict (slug) do nothing;

-- 2) Akun admin. `users.id` bertipe text tanpa default → diisi eksplisit.
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

-- 3) Keanggotaan ADMIN (idempoten lewat unique (company_id, user_id)).
insert into memberships (company_id, user_id, company_role, status)
select c.id, u.id, 'ADMIN', 'ACTIVE'
  from companies c, users u
 where c.slug = '__SLUG__'
   and u.email = '__EMAIL__'
on conflict (company_id, user_id) do update
  set company_role = 'ADMIN', status = 'ACTIVE', updated_at = now();

-- 4) Audit. `activity_logs.company_id` NOT NULL DEFAULT app_current_company_id(),
--    jadi GUC diset lebih dulu pada sesi ini (bukan RLS — tabel ini FORCE RLS
--    sehingga SET LOCAL wajib berada di dalam transaksi yang sama).
select set_config('app.current_company_id', (select id::text from companies where slug = '__SLUG__'), true);

insert into activity_logs (object_type, object_id, project_id, action, changes, reason)
values (
  'USER',
  (select id from users where email = '__EMAIL__'),
  null,
  'ADMIN_ACCOUNT_PROVISIONED',
  jsonb_build_array(jsonb_build_object('field', 'email', 'old', null, 'new', '__EMAIL__')),
  'Provisioning admin lewat SQL Editor'
);

commit;

-- 5) Verifikasi: satu baris, role ADMIN, panjang_hash = 161.
select u.email, u.role, length(u.password_hash) as panjang_hash, m.company_role, m.status
  from users u
  join memberships m on m.user_id = u.id
 where u.email = '__EMAIL__';
