-- S2b · PO berbasis pos, termin anti double-invoice, dan pengaman CO lama
-- Target PostgreSQL 15+ / PGlite. Dijalankan SETELAH 0000 + 0001 + 0002 oleh
-- scripts/migrate.ts dalam SATU transaksi. Semua backfill bersifat NON-DESTRUKTIF
-- dan dilakukan per company karena 27 tabel sudah ENABLE + FORCE RLS.

/* -------------------------------------------------------------------------- */
/* 1. po_items (audit §10.5)                                                  */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS po_items (
  id                  text PRIMARY KEY,
  company_id          uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  purchase_record_id  text NOT NULL REFERENCES purchase_records(id) ON DELETE CASCADE,
  budget_line_id      text REFERENCES budget_lines(id),
  description         text NOT NULL,
  quantity            numeric(18,4) NOT NULL DEFAULT 0,
  unit_code           text NOT NULL DEFAULT 'Ls',
  unit_amount         numeric(18,2) NOT NULL DEFAULT 0,
  dpp_amount          numeric(18,2) NOT NULL DEFAULT 0,
  received_qty        numeric(18,4) NOT NULL DEFAULT 0,
  sort_order          integer NOT NULL DEFAULT 0,
  CONSTRAINT po_item_qty_positive CHECK (quantity > 0),
  CONSTRAINT po_item_received_bounds CHECK (received_qty >= 0 AND received_qty <= quantity),
  CONSTRAINT po_item_amount_consistent CHECK (dpp_amount = round(quantity * unit_amount, 2))
);
CREATE INDEX IF NOT EXISTS po_items_po_idx ON po_items (purchase_record_id, sort_order);
CREATE INDEX IF NOT EXISTS po_items_budget_line_idx ON po_items (budget_line_id);

ALTER TABLE expense_lines ADD COLUMN IF NOT EXISTS po_item_id text REFERENCES po_items(id);
CREATE INDEX IF NOT EXISTS expense_lines_po_item_idx ON expense_lines (po_item_id);

ALTER TABLE purchase_records ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE purchase_records ADD COLUMN IF NOT EXISTS closed_at timestamptz;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_dpp_nonneg') THEN
    ALTER TABLE purchase_records
      ADD CONSTRAINT purchase_dpp_nonneg CHECK (dpp_amount >= 0) NOT VALID;
  END IF;
END $mig$;

/* -------------------------------------------------------------------------- */
/* 2. Termin: kumulatif tagihan & status (audit B5)                          */
/* -------------------------------------------------------------------------- */

ALTER TABLE contract_terms ADD COLUMN IF NOT EXISTS invoiced_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE contract_terms ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN';
ALTER TABLE contract_terms ADD COLUMN IF NOT EXISTS is_auto_amount boolean NOT NULL DEFAULT true;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_terms_invoiced_nonneg') THEN
    ALTER TABLE contract_terms
      ADD CONSTRAINT contract_terms_invoiced_nonneg CHECK (invoiced_amount >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_terms_status_valid') THEN
    ALTER TABLE contract_terms
      ADD CONSTRAINT contract_terms_status_valid
      CHECK (status IN ('OPEN','PARTIALLY_INVOICED','INVOICED','CLOSED')) NOT VALID;
  END IF;
END $mig$;
CREATE INDEX IF NOT EXISTS contract_terms_project_status_idx ON contract_terms (company_id, project_id, status);

ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS over_invoice_reason text;
CREATE INDEX IF NOT EXISTS customer_invoices_term_idx ON customer_invoices (company_id, contract_term_id, status);

/* -------------------------------------------------------------------------- */
/* 3. CO lama: bukti klien, pembatalan, dan penanda adapter                  */
/* -------------------------------------------------------------------------- */

ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS variation_type text NOT NULL DEFAULT 'ADD';
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS client_reference text;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS client_approved_at timestamptz;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS client_approved_by text REFERENCES users(id);
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS evidence_file_id text REFERENCES file_objects(id);
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS superseded_by_variation_id text;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_variation_type_valid') THEN
    ALTER TABLE change_orders
      ADD CONSTRAINT change_orders_variation_type_valid
      CHECK (variation_type IN ('ADD','OMIT','SUBSTITUTE')) NOT VALID;
  END IF;
END $mig$;

/* -------------------------------------------------------------------------- */
/* 4. Backfill NON-DESTRUKTIF per company                                     */
/* -------------------------------------------------------------------------- */

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM companies LOOP
    PERFORM set_config('app.current_company_id', c.id::text, true);

    -- PO lama -> satu pos agar rekonsiliasi PO_BILL lama tetap berjalan.
    INSERT INTO po_items (id, company_id, purchase_record_id, budget_line_id, description,
                          quantity, unit_code, unit_amount, dpp_amount, received_qty, sort_order)
    SELECT 'poi-' || p.id, p.company_id, p.id, p.budget_line_id, coalesce(nullif(p.summary, ''), p.supplier_name),
           1, 'Ls', p.dpp_amount, p.dpp_amount,
           CASE WHEN p.status IN ('RECEIVED','CLOSED') THEN 1 ELSE 0 END, 0
      FROM purchase_records p
     WHERE p.company_id = c.id
       AND NOT EXISTS (SELECT 1 FROM po_items pi WHERE pi.purchase_record_id = p.id);

    -- Kumulatif tagihan termin dari invoice yang belum dibatalkan.
    UPDATE contract_terms ct
       SET invoiced_amount = COALESCE((
             SELECT SUM(ci.total_amount) FROM customer_invoices ci
              WHERE ci.contract_term_id = ct.id AND ci.status <> 'CANCELLED'), 0)
     WHERE ct.company_id = c.id;
    UPDATE contract_terms
       SET status = CASE
             WHEN invoiced_amount <= 0 THEN 'OPEN'
             WHEN amount > 0 AND invoiced_amount >= amount THEN 'INVOICED'
             ELSE 'PARTIALLY_INVOICED' END
     WHERE company_id = c.id;
  END LOOP;
  -- Jangan meninggalkan scope company/permission pada koneksi migrasi.
  PERFORM set_config('app.current_company_id', '', false);
  PERFORM set_config('app.current_permissions', '', false);
END $$;

/* -------------------------------------------------------------------------- */
/* 5. Trigger: status termin selalu mengikuti invoice & perubahan pagu       */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION trg_contract_terms_status_recalc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Status CLOSED adalah keputusan manual; jangan ditimpa otomatis.
  IF NEW.status = 'CLOSED' THEN RETURN NEW; END IF;
  NEW.status := CASE
    WHEN COALESCE(NEW.invoiced_amount, 0) <= 0 THEN 'OPEN'
    WHEN COALESCE(NEW.amount, 0) > 0 AND NEW.invoiced_amount >= NEW.amount THEN 'INVOICED'
    ELSE 'PARTIALLY_INVOICED' END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contract_terms_status_recalc ON contract_terms;
CREATE TRIGGER contract_terms_status_recalc
  BEFORE UPDATE OF amount, invoiced_amount ON contract_terms
  FOR EACH ROW EXECUTE FUNCTION trg_contract_terms_status_recalc();

/* -------------------------------------------------------------------------- */
/* 5b. Trigger: kumulatif tagihan per termin                                 */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION recalc_contract_term_invoiced(p_term_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v numeric(18,2);
BEGIN
  SELECT COALESCE(SUM(total_amount), 0) INTO v FROM customer_invoices
   WHERE contract_term_id = p_term_id AND status <> 'CANCELLED';
  UPDATE contract_terms
     SET invoiced_amount = v,
         status = CASE
           WHEN v <= 0 THEN 'OPEN'
           WHEN amount > 0 AND v >= amount THEN 'INVOICED'
           ELSE 'PARTIALLY_INVOICED' END
   WHERE id = p_term_id;
END $$;

CREATE OR REPLACE FUNCTION trg_customer_invoices_term_recalc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.contract_term_id IS NOT NULL THEN PERFORM recalc_contract_term_invoiced(OLD.contract_term_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.contract_term_id IS NOT NULL THEN PERFORM recalc_contract_term_invoiced(NEW.contract_term_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.contract_term_id IS DISTINCT FROM NEW.contract_term_id
     AND OLD.contract_term_id IS NOT NULL THEN
    PERFORM recalc_contract_term_invoiced(OLD.contract_term_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS customer_invoices_term_recalc ON customer_invoices;
CREATE TRIGGER customer_invoices_term_recalc
  AFTER INSERT OR UPDATE OR DELETE ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_customer_invoices_term_recalc();

/* -------------------------------------------------------------------------- */
/* 6. Trigger: pagu termin & pagu kontrak (anti double-invoice)               */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION assert_invoice_term_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_term_amount numeric(18,2);
  v_term_used numeric(18,2);
  v_term_project text;
  v_contract numeric(18,2);
  v_base numeric(18,2);
  v_project_used numeric(18,2);
  v_allowed boolean;
BEGIN
  IF NEW.status = 'CANCELLED' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.total_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Total invoice tidak boleh negatif.' USING ERRCODE = 'check_violation';
  END IF;

  v_allowed := NEW.over_invoice_reason IS NOT NULL
               AND length(btrim(NEW.over_invoice_reason)) >= 5
               AND app_has_permission('invoice.approve');

  -- Pagu termin hanya untuk invoice yang tertaut ke termin; pagu kontrak
  -- tetap berlaku untuk SEMUA invoice (audit B5).
  IF NEW.contract_term_id IS NOT NULL THEN
    SELECT amount, project_id INTO v_term_amount, v_term_project
      FROM contract_terms WHERE id = NEW.contract_term_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Termin % tidak ditemukan', NEW.contract_term_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.project_id IS DISTINCT FROM v_term_project THEN
      RAISE EXCEPTION 'Termin % bukan milik proyek %', NEW.contract_term_id, NEW.project_id USING ERRCODE = 'check_violation';
    END IF;
    v_term_amount := COALESCE(v_term_amount, 0);
    SELECT COALESCE(SUM(total_amount), 0) INTO v_term_used FROM customer_invoices
     WHERE contract_term_id = NEW.contract_term_id AND status <> 'CANCELLED' AND id <> NEW.id;
    IF v_term_used + NEW.total_amount > v_term_amount AND NOT v_allowed THEN
      RAISE EXCEPTION 'Tagihan termin melebihi pagu termin (% / %). Isi alasan over-invoice dan gunakan peran invoice.approve.',
        v_term_used + NEW.total_amount, v_term_amount USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT contract_value_current, contract_value INTO v_contract, v_base
    FROM projects WHERE id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyek % tidak ditemukan', NEW.project_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  v_contract := COALESCE(v_contract, v_base, 0);
  SELECT COALESCE(SUM(total_amount), 0) INTO v_project_used FROM customer_invoices
   WHERE project_id = NEW.project_id AND status <> 'CANCELLED' AND id <> NEW.id;
  IF v_project_used + NEW.total_amount > v_contract AND NOT v_allowed THEN
    RAISE EXCEPTION 'Akumulasi tagihan melebihi nilai kontrak berjalan (% / %). Isi alasan over-invoice dan gunakan peran invoice.approve.',
      v_project_used + NEW.total_amount, v_contract USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS customer_invoices_term_limit ON customer_invoices;
CREATE TRIGGER customer_invoices_term_limit
  BEFORE INSERT OR UPDATE OF total_amount, contract_term_id, status, over_invoice_reason ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION assert_invoice_term_limit();

/* -------------------------------------------------------------------------- */
/* 8. RLS + integritas company/project untuk po_items (tabel ke-28)           */
/* -------------------------------------------------------------------------- */

ALTER TABLE po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation_select ON po_items;
CREATE POLICY company_isolation_select ON po_items FOR SELECT USING (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_insert ON po_items;
CREATE POLICY company_isolation_insert ON po_items FOR INSERT WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_update ON po_items;
CREATE POLICY company_isolation_update ON po_items FOR UPDATE USING (company_id = app_current_company_id()) WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_delete ON po_items;
CREATE POLICY company_isolation_delete ON po_items FOR DELETE USING (company_id = app_current_company_id());

/* -------------------------------------------------------------------------- */
/* 9. Integritas company/project pada pos PO & tagihan                       */
/* -------------------------------------------------------------------------- */

CREATE UNIQUE INDEX IF NOT EXISTS po_items_company_id_idx ON po_items (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_records_company_id_idx ON purchase_records (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS contract_terms_company_id_idx ON contract_terms (company_id, id);

DO $$
BEGIN
  BEGIN
    ALTER TABLE po_items ADD CONSTRAINT po_items_po_company_fk
      FOREIGN KEY (company_id, purchase_record_id) REFERENCES purchase_records (company_id, id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_po_item_company_fk
      FOREIGN KEY (company_id, po_item_id) REFERENCES po_items (company_id, id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE customer_invoices ADD CONSTRAINT customer_invoices_term_company_fk
      FOREIGN KEY (company_id, contract_term_id) REFERENCES contract_terms (company_id, id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION assert_po_item_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_po_project text;
  v_po_company uuid;
  v_budget_project text;
  v_item record;
BEGIN
  IF TG_TABLE_NAME = 'po_items' THEN
    SELECT project_id, company_id INTO v_po_project, v_po_company
      FROM purchase_records WHERE id = NEW.purchase_record_id;
    IF NOT FOUND OR NEW.company_id <> v_po_company THEN
      RAISE EXCEPTION 'Pos PO harus tertaut ke PO dalam company yang sama.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.budget_line_id IS NOT NULL THEN
      SELECT bv.project_id INTO v_budget_project
        FROM budget_lines bl JOIN budget_versions bv ON bv.id = bl.budget_version_id
       WHERE bl.id = NEW.budget_line_id;
      IF NOT FOUND OR v_budget_project <> v_po_project THEN
        RAISE EXCEPTION 'Pos RAB % bukan milik proyek PO %', NEW.budget_line_id, v_po_project USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'expense_lines' AND NEW.po_item_id IS NOT NULL THEN
    SELECT company_id, purchase_record_id, budget_line_id INTO v_item
      FROM po_items WHERE id = NEW.po_item_id;
    IF NOT FOUND OR NEW.company_id <> v_item.company_id THEN
      RAISE EXCEPTION 'Pos PO % tidak ditemukan dalam company ini.', NEW.po_item_id USING ERRCODE = 'check_violation';
    END IF;
    SELECT project_id INTO v_po_project FROM purchase_records WHERE id = v_item.purchase_record_id;
    IF NEW.project_id IS NOT NULL AND NEW.project_id <> v_po_project THEN
      RAISE EXCEPTION 'Baris tagihan PO bukan milik proyek %', v_po_project USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.budget_line_id IS NOT NULL AND v_item.budget_line_id IS NOT NULL
       AND NEW.budget_line_id <> v_item.budget_line_id THEN
      RAISE EXCEPTION 'Pos RAB baris tagihan harus sama dengan pos PO.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS po_items_scope ON po_items;
CREATE TRIGGER po_items_scope
  BEFORE INSERT OR UPDATE OF company_id, purchase_record_id, budget_line_id ON po_items
  FOR EACH ROW EXECUTE FUNCTION assert_po_item_scope();

DROP TRIGGER IF EXISTS expense_lines_po_item_scope ON expense_lines;
CREATE TRIGGER expense_lines_po_item_scope
  BEFORE INSERT OR UPDATE OF company_id, po_item_id, budget_line_id, project_id ON expense_lines
  FOR EACH ROW EXECUTE FUNCTION assert_po_item_scope();

-- Catatan: `is_auto_amount` dipakai service S2a saat rekalkulasi termin PTK:
-- hanya termin yang belum ditagihkan penuh yang boleh disesuaikan otomatis.
