-- MASTER DATA (tahap 2, migrasi 0006): kode unik PER COMPANY.
--
-- Sebelum ini `clients.code`, `opportunities.code`, dan `projects.code` memakai
-- UNIQUE global (warisan skema single-company pra-S1). Akibatnya company B tidak
-- bisa memakai kode yang sudah dipakai company A — padahal nomor proyek/klien
-- wajar berulang antar perusahaan (mis. "PRJ-2026-001").
--
-- Perubahan: ganti UNIQUE global -> UNIQUE (company_id, code), plus index untuk
-- pencarian kode per company. Forward-only, tanpa down script.
-- Tidak ada perubahan data: hanya constraint/index.

/* -------------------------------------------------------------------------- */
/* 1. Lepas UNIQUE global (nama constraint bervariasi: <tabel>_code_key)      */
/* -------------------------------------------------------------------------- */

DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'opportunities', 'projects'] LOOP
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = format('public.%I', t)::regclass
         AND contype = 'u'
         AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = format('public.%I', t)::regclass
                                AND attname = 'code')]
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
    -- Index unik implisit (dibuat manual/Drizzle `unique()` tanpa constraint).
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_code_key');
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_code_unique');
  END LOOP;
END $$;

/* -------------------------------------------------------------------------- */
/* 2. UNIQUE per company                                                      */
/* -------------------------------------------------------------------------- */

CREATE UNIQUE INDEX IF NOT EXISTS clients_company_code_idx ON clients (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_company_code_idx ON opportunities (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS projects_company_code_idx ON projects (company_id, code);

CREATE INDEX IF NOT EXISTS sites_client_idx ON sites (company_id, client_id);
