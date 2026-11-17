-- S1 · Fondasi isolasi data per company
-- Target: PostgreSQL 15+ (Neon / Supabase Postgres). Idempoten: aman dijalankan ulang
-- oleh scripts/migrate.ts yang mencatat versi pada tabel _migrations.
--
-- Prinsip: SEMUA tabel data bisnis mendapat company_id. Nilai default diambil dari
-- GUC request-scoped app.current_company_id yang di-set dengan SET LOCAL oleh
-- withCompany(). Tanpa scope, default NULL -> NOT NULL gagal (fail-closed).

-- gen_random_uuid() bawaan PostgreSQL 13+ (Neon/Supabase PG 15+), tidak butuh pgcrypto.

-- Dibaca oleh DEFAULT kolom dan oleh seluruh policy RLS.
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_company_id', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  legal_name  text NOT NULL,
  npwp        text,
  address     text,
  phone       text,
  email       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Identitas global (users) + keanggotaan per company. Role OTORITATIF ada di sini,
-- bukan di users.role (users.role tetap ada sebagai fallback legacy utk seed).
CREATE TABLE IF NOT EXISTS memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_role text NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE',
  invited_by  text REFERENCES users(id),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id, status);

-- Undangan: token HANYA disimpan sebagai hash. Token mentah dikembalikan sekali
-- saat pembuatan; pengiriman email di luar scope S1 (lihat docs/runbook/DEPLOY.md).
CREATE TABLE IF NOT EXISTS invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email        text NOT NULL,
  company_role text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  invited_by   text NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_company_email_idx ON invitations (company_id, email);

-- Log autentikasi (control-plane, tidak di-RLS). Dipakai juga sebagai dasar
-- rate limit terdistribusi, menggantikan Map in-memory yang hilang saat cold start.
CREATE TABLE IF NOT EXISTS auth_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id),
  user_id     text REFERENCES users(id),
  email       text NOT NULL,
  action      text NOT NULL,
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_events_email_time_idx ON auth_events (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_ip_time_idx ON auth_events (ip_address, created_at DESC);

-- Satu company untuk data yang SUDAH ADA. Keputusan: backfill non-destruktif,
-- bukan reset (lihat keputusan #2 di docs/AUDIT-EPC-2026-11-17.md §8).
INSERT INTO companies (slug, name, legal_name)
VALUES ('default', 'Perusahaan Default', 'Perusahaan Default')
ON CONFLICT (slug) DO NOTHING;

-- Set untuk sesi migrasi agar DEFAULT company_id terisi pada baris existing.
SELECT set_config('app.current_company_id',
                  (SELECT id::text FROM companies WHERE slug = 'default'), false);

-- 24 tabel data bisnis: company_id NOT NULL + FK + index.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','sites','opportunities','projects','project_members','contract_terms',
    'budget_versions','budget_lines','purchase_records','file_objects',
    'expenses','expense_lines','expense_settlements','customer_invoices','customer_payments',
    'schedule_items','progress_updates','change_orders','punch_items','handover_items',
    'documents','activity_logs','notifications','company_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN company_id uuid NOT NULL DEFAULT app_current_company_id()', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id)', t, t || '_company_fk');
    EXECUTE format('CREATE INDEX %I ON %I (company_id)', t || '_company_idx', t);
  END LOOP;
END $$;

-- Katalog bersama (bukan data company): company_id NULL = shared, bisa dioverride
-- per company nanti oleh Sector Profiles (S6). Tidak di-RLS pada S1.
ALTER TABLE cost_categories ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE units ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

-- Sesi terikat pada company yang dipilih saat login. Tidak ada DEFAULT: login
-- wajib menentukan company secara eksplisit (tidak boleh mengandalkan GUC).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE sessions SET company_id = (SELECT id FROM companies WHERE slug = 'default')
 WHERE company_id IS NULL;
ALTER TABLE sessions ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_company_fk') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_company_fk
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at);

-- Keanggotaan untuk seluruh user lama, memakai role legacy mereka.
INSERT INTO memberships (company_id, user_id, company_role, status)
SELECT (SELECT id FROM companies WHERE slug = 'default'), u.id, u.role, 'ACTIVE'
FROM users u
ON CONFLICT (company_id, user_id) DO NOTHING;

-- Index komposit untuk query yang paling sering dipakai dashboard & workspace.
CREATE INDEX IF NOT EXISTS projects_company_stage_idx     ON projects (company_id, stage);
CREATE INDEX IF NOT EXISTS expenses_company_status_idx    ON expenses (company_id, approval_status);
CREATE INDEX IF NOT EXISTS expenses_company_created_idx   ON expenses (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS expense_lines_company_exp_idx  ON expense_lines (company_id, expense_id);
CREATE INDEX IF NOT EXISTS budget_lines_company_ver_idx   ON budget_lines (company_id, budget_version_id);
CREATE INDEX IF NOT EXISTS documents_company_project_idx  ON documents (company_id, project_id);
CREATE INDEX IF NOT EXISTS schedule_company_project_idx   ON schedule_items (company_id, project_id);
CREATE INDEX IF NOT EXISTS progress_company_project_date_idx ON progress_updates (company_id, project_id, report_date);
CREATE INDEX IF NOT EXISTS activity_company_created_idx   ON activity_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_company_user_idx ON notifications (company_id, user_id);
CREATE INDEX IF NOT EXISTS payments_company_invoice_idx   ON customer_payments (company_id, invoice_id);

-- Baseline aktif tunggal per (project, type). Mencegah dua baseline aktif karena race.
CREATE UNIQUE INDEX IF NOT EXISTS budget_one_active_baseline_idx
  ON budget_versions (company_id, project_id, type) WHERE is_active_baseline = true;

-- Audit: activity_logs diperkaya, lalu dipetakan sebagai view audit_logs.
-- Immutability ditegakkan di database, bukan lagi sekadar konvensi aplikasi.
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS ip_address text;

CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log bersifat append-only (company_id=%)', OLD.company_id
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS activity_logs_immutable ON activity_logs;
CREATE TRIGGER activity_logs_immutable
  BEFORE UPDATE OR DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

-- security_invoker=true (PG 15+) agar RLS tabel dasar tetap berlaku lewat view.
DROP VIEW IF EXISTS audit_logs;
CREATE VIEW audit_logs WITH (security_invoker = true) AS
SELECT id,
       company_id,
       actor_id,
       object_type AS object,
       object_id,
       action,
       changes     AS diff,
       reason,
       request_id,
       ip_address,
       created_at
FROM activity_logs;
