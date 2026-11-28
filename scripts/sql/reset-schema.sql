-- ==========================================================================
-- HAPUS SELURUH OBJEK SKEMA `public`.
--
-- Ini bersifat DESTRUKTIF: semua tabel, data, policy, dan fungsi di skema
-- public dihapus. Satu-satunya alasan berkas ini ada: memindahkan data demo
-- ke skema yang benar. Pada database yang rantai migrasinya belum pernah jalan,
-- kolom seperti `projects.stage` tidak ada, sehingga migrasi selalu gagal
-- (diverifikasi). Skema lama harus dibangun ulang dari nol.
--
-- SEBELUM menjalankan ini:
--   1. Buat branch database di Neon (Branches -> Create branch) supaya ada
--      salinan yang bisa dikembalikan. Jangan lewati langkah ini.
--   2. Pastikan tidak ada data klien nyata di database ini. Kalau ada, JANGAN
--      jalankan berkas ini — hentikan dan laporkan.
--
-- Sesudah ini, jalankan migrate.sql (gabungan migrasi) dan provision-admin.
-- ==========================================================================

begin;

-- Hapus semua tabel (urutan tidak penting karena CASCADE menangani FK).
do $reset$
declare
  obj record;
begin
  for obj in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade', obj.tablename);
  end loop;

  -- View biasa (mis. audit_logs) yang tersisa.
  for obj in
    select viewname from pg_views where schemaname = 'public'
  loop
    execute format('drop view if exists public.%I cascade', obj.viewname);
  end loop;

  -- Fungsi milik aplikasi (termasuk trigger function & app_current_company_id).
  for obj in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('drop function if exists public.%I(%s) cascade', obj.proname, obj.args);
  end loop;
end $reset$;

drop schema if exists public cascade;
create schema public;

grant usage on schema public to public;
grant create on schema public to public;

commit;

-- Verifikasi: harus 0.
select count(*) as sisa_tabel from information_schema.tables where table_schema = 'public';
