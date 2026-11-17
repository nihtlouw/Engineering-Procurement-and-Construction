-- S1 · Row Level Security untuk isolasi data per company
--
-- FORCE ROW LEVEL SECURITY penting: pada Neon/Supabase, user yang menjalankan
-- migrasi sekaligus memiliki tabel. Tanpa FORCE, owner MELEWATI RLS sehingga
-- isolasi hanya ilusi. Dengan FORCE, setiap query WAJIB berada di dalam
-- withCompany() -> SET LOCAL app.current_company_id (lihat src/shared/auth/route.ts).
--
-- Tabel control-plane (users, sessions, companies, memberships, invitations,
-- cost_categories, units) SENGAJA tidak di-RLS: identitas bersifat global dan
-- aksesnya dijaga oleh requireUser() + filter company_id eksplisit pada helper
-- modul companies. Lihat docs/AUDIT-EPC-2026-11-17.md §4.3 (Opsi A).

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

-- Isolasi RAB INTERNAL (berisi margin) BUKAN masalah company isolation, tetapi
-- masalah permission per peran. Karena policy SELECT di PostgreSQL digabung OR,
-- menambahkan policy "khusus internal" di sini justru akan MELEMAHKAN isolasi.
-- Maka ia ditegakkan di lapisan DTO: getWorkspaceData() hanya mengirim
-- type='INTERNAL' bila hasPermission(user,'budget.internal.view'), dan diuji
-- matriks peran pada tests/unit/rbac.test.ts. Pemisahan role DB (_opsi lanjutan)
-- dijadwalkan S2, bukan S1.
