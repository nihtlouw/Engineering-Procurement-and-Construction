-- Hardening (tahap 1): jejak pembuat invoice + isolasi notifikasi per pengguna.
-- Dijalankan SETELAH 0000 → 0004 oleh scripts/migrate.ts dalam SATU transaksi.
-- Forward-only, tanpa down script. Non-destruktif: hanya menambah kolom + policy.
--
-- 1. `customer_invoices.created_by_id` — tanpa kolom ini pemisahan tugas
--    (pembuat tidak boleh menyetujui sendiri) tidak bisa ditegakkan di server.
--    Backfill: actor pertama yang tercatat di activity_logs untuk invoice itu.
--    Invoice lama tanpa jejak audit dibiarkan NULL (fail-closed: tidak ada
--    klaim pemisahan tugas palsu, dan ADMIN tetap bisa override).
-- 2. Policy RESTRICTIVE pada `notifications` — sebelumnya seluruh policy hanya
--    memfilter `company_id`, sehingga GET workspace mengirim notifikasi milik
--    pengguna LAIN di company yang sama. SELECT/UPDATE sekarang dibatasi ke
--    `user_id` sendiri. INSERT sengaja TIDAK dibatasi: notifikasi untuk approver
--    dibuat oleh pengaju (pola yang sudah dipakai modul expense).

/* -------------------------------------------------------------------------- */
/* 1. customer_invoices.created_by_id                                         */
/* -------------------------------------------------------------------------- */

ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS created_by_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_invoices_created_by_fk'
  ) THEN
    ALTER TABLE customer_invoices
      ADD CONSTRAINT customer_invoices_created_by_fk
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customer_invoices_created_by_idx
  ON customer_invoices (company_id, created_by_id);

-- Backfill dari audit trail (prioritas: CREATED, lalu aksi apa pun paling awal).
UPDATE customer_invoices ci
   SET created_by_id = src.actor_id
  FROM (
    SELECT DISTINCT ON (object_id) object_id, actor_id
      FROM activity_logs
     WHERE object_type = 'INVOICE' AND actor_id IS NOT NULL
     ORDER BY object_id,
              CASE action WHEN 'CREATED' THEN 0 ELSE 1 END,
              created_at ASC
  ) src
 WHERE ci.id = src.object_id
   AND ci.created_by_id IS NULL;

/* -------------------------------------------------------------------------- */
/* 2. Notifikasi hanya terbaca oleh pemiliknya                                */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'notifications' AND policyname = 'notifications_owner_select'
  ) THEN
    -- RESTRICTIVE = digabung AND dengan policy company isolation, sehingga tidak
    -- bisa "menambah" akses (kesalahan yang dihindari pada S2a via RESTRICTIVE).
    CREATE POLICY notifications_owner_select ON notifications
      AS RESTRICTIVE FOR SELECT
      USING (user_id = app_current_user_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'notifications' AND policyname = 'notifications_owner_update'
  ) THEN
    CREATE POLICY notifications_owner_update ON notifications
      AS RESTRICTIVE FOR UPDATE
      USING (user_id = app_current_user_id())
      WITH CHECK (user_id = app_current_user_id());
  END IF;
END $$;
