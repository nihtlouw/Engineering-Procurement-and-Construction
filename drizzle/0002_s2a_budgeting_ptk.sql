-- S2a · RAB + baseline + pagu + Pekerjaan Tambah/Kurang (PTK)
-- Target PostgreSQL 15+ / PGlite. Dijalankan SETELAH 0000 + 0001 oleh scripts/migrate.ts
-- dalam SATU transaksi, sehingga DDL yang melemahkan sementara FORCE RLS tidak
-- pernah terlihat transaksi lain (ACCESS EXCLUSIVE lock + rollback bila gagal).
--
-- Prinsip yang dipegang dari audit §10:
--  * budget_lines adalah SATU-SATUNYA tabel pos RAB (tidak ada rab_items duplikat).
--  * projects.contract_value_current adalah SATU sumber nilai kontrak berjalan;
--    change_orders lama tetap ada sebagai adapter lewat trigger yang sama.
--  * RAB internal dijaga policy AS RESTRICTIVE (AND), BUKAN permissive (OR).
--  * Semua dampak PTK bertanda (bisa negatif) dengan guard nilai kontrak >= 0.

CREATE OR REPLACE FUNCTION app_has_permission(required text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    required = ANY(string_to_array(nullif(current_setting('app.current_permissions', true), ''), ',')),
    false
  )
$$;

/* -------------------------------------------------------------------------- */
/* 1. Kolom turunan & hook S5/S6 pada pos RAB                                */
/* -------------------------------------------------------------------------- */

-- Nilai turunan dihitung DB sehingga `total` tidak bisa drift dari volume × harga.
-- `NOT VALID` tidak diperlukan: generated column hanya menambah kolom, baris lama
-- tetap terbaca dan `total` lama tidak diubah (kompatibel dengan data pra-S2a).
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS computed_total numeric(18,2)
  GENERATED ALWAYS AS (round(quantity * unit_amount, 2)) STORED;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS contingency_amount numeric(18,2)
  GENERATED ALWAYS AS (round(quantity * unit_amount * coalesce(contingency_pct, 0) / 100, 2)) STORED;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS pagu_amount numeric(18,2)
  GENERATED ALWAYS AS (round(quantity * unit_amount * (1 + coalesce(contingency_pct, 0) / 100), 2)) STORED;

-- B10: revisi & audit diff; B3/B7/B8: status pos, asal PTK, hook WBS & Price Reference.
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS variation_action text;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS source_variation_id text;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS wbs_item_id text;
ALTER TABLE budget_lines ADD COLUMN IF NOT EXISTS keywords text;

ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS revision_note text;
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS superseded_by text;
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS source_variation_id text;
ALTER TABLE budget_versions ADD COLUMN IF NOT EXISTS created_from_version_id text;

CREATE INDEX IF NOT EXISTS budget_lines_source_variation_idx ON budget_lines (source_variation_id);
CREATE INDEX IF NOT EXISTS budget_lines_wbs_idx ON budget_lines (wbs_item_id);

/* -------------------------------------------------------------------------- */
/* 2. SATU sumber nilai kontrak berjalan                                     */
/* -------------------------------------------------------------------------- */

ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_value_current numeric(18,2);

-- Backfill per company (bukan satu UPDATE global): RLS FORCE aktif sejak 0001,
-- jadi scope harus dipindah per company agar seluruh baris tersentuh.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM companies LOOP
    PERFORM set_config('app.current_company_id', c.id::text, true);
    UPDATE projects p
       SET contract_value_current = p.contract_value + COALESCE((
             SELECT SUM(co.price_impact) FROM change_orders co
              WHERE co.project_id = p.id AND co.status IN ('APPROVED', 'IMPLEMENTED')), 0)
     WHERE p.company_id = c.id AND p.contract_value_current IS NULL;
  END LOOP;
END $$;

ALTER TABLE projects ALTER COLUMN contract_value_current SET DEFAULT 0;
UPDATE projects SET contract_value_current = contract_value WHERE contract_value_current IS NULL;
ALTER TABLE projects ALTER COLUMN contract_value_current SET NOT NULL;
ALTER TABLE projects ADD CONSTRAINT projects_contract_value_nonneg
  CHECK (contract_value_current >= 0) NOT VALID;

CREATE OR REPLACE FUNCTION trg_recalc_contract_from_change_order() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recalculate_project_contract_value(NEW.project_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_recalc_contract_from_variation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recalculate_project_contract_value(NEW.project_id);
  RETURN NEW;
END $$;

-- Dampak perubahan nilai kontrak dasar (bukan kontrak berjalan) juga dihitung ulang.
CREATE OR REPLACE FUNCTION trg_recalc_contract_from_project() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recalculate_project_contract_value(NEW.id);
  RETURN NEW;
END $$;

/* -------------------------------------------------------------------------- */
/* 3. PTK / Variation Order                                                   */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS variation_orders (
  id                     text PRIMARY KEY,
  company_id             uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  project_id             text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code                   text NOT NULL UNIQUE,
  variation_type         text NOT NULL,          -- ADD | OMIT | SUBSTITUTE
  title                  text NOT NULL,
  reason                 text NOT NULL,
  scope_description      text NOT NULL,
  price_impact           numeric(18,2) NOT NULL DEFAULT 0,  -- BERTANDA, DPP klien
  cost_impact            numeric(18,2) NOT NULL DEFAULT 0,  -- BERTANDA, biaya internal
  time_impact_days       integer NOT NULL DEFAULT 0,        -- BERTANDA
  status                 text NOT NULL DEFAULT 'DRAFT',
  client_reference       text,
  client_approved_at     timestamptz,
  client_approved_by     text REFERENCES users(id),
  evidence_file_id       text REFERENCES file_objects(id),
  contract_value_before  numeric(18,2),
  contract_value_after   numeric(18,2),
  cancel_reason          text,
  implemented_at         timestamptz,
  created_by_id          text NOT NULL REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variation_type_valid CHECK (variation_type IN ('ADD', 'OMIT', 'SUBSTITUTE')),
  CONSTRAINT variation_status_valid CHECK (status IN
    ('DRAFT','INTERNAL_REVIEW','AWAITING_CLIENT','APPROVED','IMPLEMENTED','REJECTED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS variation_orders_project_idx ON variation_orders (company_id, project_id, status);

CREATE TABLE IF NOT EXISTS variation_order_lines (
  id                  text PRIMARY KEY,
  company_id          uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  variation_order_id  text NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  action              text NOT NULL,            -- ADD | OMIT | ADJUST
  budget_type         text NOT NULL DEFAULT 'INTERNAL', -- CLIENT | INTERNAL
  budget_line_id      text,                    -- wajib untuk OMIT / ADJUST
  description         text NOT NULL,
  quantity            numeric(18,4) NOT NULL DEFAULT 0,
  unit_code           text NOT NULL DEFAULT 'Ls',
  unit_amount         numeric(18,2) NOT NULL DEFAULT 0,
  price_amount        numeric(18,2) NOT NULL DEFAULT 0,
  cost_amount         numeric(18,2) NOT NULL DEFAULT 0,
  sort_order          integer NOT NULL DEFAULT 0,
  CONSTRAINT variation_line_action_valid CHECK (action IN ('ADD','OMIT','ADJUST')),
  CONSTRAINT variation_line_target_required CHECK
    (action = 'ADD' OR budget_line_id IS NOT NULL),
  CONSTRAINT variation_line_budget_type_valid CHECK (budget_type IN ('CLIENT','INTERNAL'))
);
CREATE INDEX IF NOT EXISTS variation_lines_order_idx ON variation_order_lines (variation_order_id, sort_order);

-- Hook B7: distribusi nilai RAB per periode untuk kurva-S (S5) & Price Reference (S6).
CREATE TABLE IF NOT EXISTS budget_phasing (
  id              text PRIMARY KEY,
  company_id      uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  budget_line_id  text NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  wbs_item_id     text,
  period_start    date NOT NULL,
  planned_value   numeric(18,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_line_id, period_start)
);
CREATE INDEX IF NOT EXISTS budget_phasing_period_idx ON budget_phasing (company_id, period_start);

CREATE OR REPLACE FUNCTION recalculate_project_contract_value(p_project_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_base numeric(18,2);
  v_legacy numeric(18,2);
  v_variation numeric(18,2);
  v_current numeric(18,2);
BEGIN
  SELECT contract_value INTO v_base FROM projects WHERE id = p_project_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(price_impact), 0) INTO v_legacy FROM change_orders
   WHERE project_id = p_project_id AND status IN ('APPROVED', 'IMPLEMENTED');
  SELECT COALESCE(SUM(price_impact), 0) INTO v_variation FROM variation_orders
   WHERE project_id = p_project_id AND status IN ('APPROVED', 'IMPLEMENTED');

  v_current := v_base + v_legacy + v_variation;
  IF v_current < 0 THEN
    RAISE EXCEPTION 'Nilai kontrak berjalan tidak boleh negatif (proyek %, dampak PTK %)', p_project_id, v_variation
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE projects SET contract_value_current = v_current, updated_at = now() WHERE id = p_project_id;
END $$;



DROP TRIGGER IF EXISTS change_orders_recalc_contract ON change_orders;
CREATE TRIGGER change_orders_recalc_contract
  AFTER INSERT OR UPDATE OF status, price_impact, project_id ON change_orders
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_contract_from_change_order();

DROP TRIGGER IF EXISTS variation_orders_recalc_contract ON variation_orders;
CREATE TRIGGER variation_orders_recalc_contract
  AFTER INSERT OR UPDATE OF status, price_impact, project_id ON variation_orders
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_contract_from_variation();

DROP TRIGGER IF EXISTS projects_recalc_contract ON projects;
CREATE TRIGGER projects_recalc_contract
  AFTER UPDATE OF contract_value ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_contract_from_project();

-- Proyek BARU juga harus langsung punya contract_value_current = contract_value,
-- kalau tidak retensi/termin akan salah baca nol.
DROP TRIGGER IF EXISTS projects_init_contract ON projects;
CREATE TRIGGER projects_init_contract
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_recalc_contract_from_project();

/* -------------------------------------------------------------------------- */
/* 4. Integritas referensi pos RAB lintas proyek (B3)                        */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION assert_budget_line_project() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_project text;
BEGIN
  IF NEW.budget_line_id IS NULL THEN RETURN NEW; END IF;
  SELECT bv.project_id INTO v_project
    FROM budget_lines bl JOIN budget_versions bv ON bv.id = bl.budget_version_id
   WHERE bl.id = NEW.budget_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pos RAB % tidak ditemukan', NEW.budget_line_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_TABLE_NAME = 'purchase_records' AND NEW.project_id IS DISTINCT FROM v_project THEN
    RAISE EXCEPTION 'Pos RAB % bukan milik proyek %', NEW.budget_line_id, NEW.project_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'expense_lines' AND NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM v_project THEN
    RAISE EXCEPTION 'Pos RAB % bukan milik proyek %', NEW.budget_line_id, NEW.project_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expense_lines_budget_scope ON expense_lines;
CREATE TRIGGER expense_lines_budget_scope
  BEFORE INSERT OR UPDATE OF budget_line_id, project_id ON expense_lines
  FOR EACH ROW EXECUTE FUNCTION assert_budget_line_project();

DROP TRIGGER IF EXISTS purchase_records_budget_scope ON purchase_records;
CREATE TRIGGER purchase_records_budget_scope
  BEFORE INSERT OR UPDATE OF budget_line_id, project_id ON purchase_records
  FOR EACH ROW EXECUTE FUNCTION assert_budget_line_project();

/* -------------------------------------------------------------------------- */
/* 5. RLS: tabel baru + kerahasiaan RAB internal (B9)                        */
/* -------------------------------------------------------------------------- */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['variation_orders','variation_order_lines','budget_phasing'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation_select ON %I', t);
    EXECUTE format('CREATE POLICY company_isolation_select ON %I FOR SELECT USING (company_id = app_current_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation_insert ON %I', t);
    EXECUTE format('CREATE POLICY company_isolation_insert ON %I FOR INSERT WITH CHECK (company_id = app_current_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation_update ON %I', t);
    EXECUTE format('CREATE POLICY company_isolation_update ON %I FOR UPDATE USING (company_id = app_current_company_id()) WITH CHECK (company_id = app_current_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS company_isolation_delete ON %I', t);
    EXECUTE format('CREATE POLICY company_isolation_delete ON %I FOR DELETE USING (company_id = app_current_company_id())', t);
  END LOOP;
END $$;

-- RESTRICTIVE = digabung AND dengan 4 policy company_isolation_* (permissive).
-- Menambah policy PERMISSIVE di sini akan di-OR dan justru MEMBOCORKAN data
-- company lain, maka bentuknya harus RESTRICTIVE. Tanpa GUC permission,
-- `app_has_permission()` = false -> RAB INTERNAL tidak terlihat (fail-closed).
DROP POLICY IF EXISTS budget_internal_visibility ON budget_versions;
CREATE POLICY budget_internal_visibility ON budget_versions
  AS RESTRICTIVE FOR SELECT
  USING (type = 'CLIENT' OR app_has_permission('budget.internal.view'));

DROP POLICY IF EXISTS budget_internal_lines_visibility ON budget_lines;
CREATE POLICY budget_internal_lines_visibility ON budget_lines
  AS RESTRICTIVE FOR SELECT
  USING (
    app_has_permission('budget.internal.view')
    OR EXISTS (
      SELECT 1 FROM budget_versions bv
       WHERE bv.id = budget_lines.budget_version_id AND bv.type = 'CLIENT'
    )
  );

/* -------------------------------------------------------------------------- */
/* 6. Katalog minimum agar editor RAB bisa dipakai di DB existing            */
/* -------------------------------------------------------------------------- */
-- `units` belum pernah di-seed; tanpanya validasi satuan menolak semua pos.
-- ON CONFLICT DO NOTHING = aman dijalankan ulang, tidak menimpa data company.
INSERT INTO cost_categories (id, code, name) VALUES
  ('cat-civ', 'CIV', 'Sipil & Mekanikal Pendukung')
ON CONFLICT DO NOTHING;
INSERT INTO units (id, code, name) VALUES
  ('unit-ls', 'Ls', 'Lump sum'), ('unit-unit', 'Unit', 'Unit'),
  ('unit-m', 'm', 'Meter'), ('unit-m2', 'm2', 'Meter persegi'),
  ('unit-m3', 'm3', 'Meter kubik'), ('unit-kg', 'kg', 'Kilogram'),
  ('unit-set', 'set', 'Set'), ('unit-hr', 'hr', 'Jam')
ON CONFLICT DO NOTHING;

/* -------------------------------------------------------------------------- */
/* 7. Catatan: contract_terms                                                 */
/* -------------------------------------------------------------------------- */
-- Rekalkulasi termin persentase + retensi dilakukan di service S2a pada saat
-- IMPLEMENT (satu transaksi dengan revisi baseline), dengan guard "tidak boleh
-- menurunkan termin di bawah nilai yang sudah ditagihkan". Kolom
-- invoiced_amount/status & `po_items` sengaja ditunda ke S2b (lihat
-- docs/modules/BUDGETING-PTK.md).
