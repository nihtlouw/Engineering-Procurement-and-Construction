-- MASTER DATA (tahap 3, migrasi 0007): termin kontrak + katalog biaya per company.
--
-- Dua hal:
--  1. `contract_terms` boleh disusun dari UI. Urutan termin unik per proyek dan
--     guard agar perubahan termin tidak merusak kumulatif tagihan (0003).
--  2. `cost_categories` dan `units` sebelumnya GLOBAL (company_id NULL = katalog
--     bersama). Company kini bisa membuat kategori/satuan sendiri; kode unik
--     PER company (katalog bersama tetap boleh dipakai semua company).
--
-- Forward-only, tanpa down script. Non-destruktif: katalog bersama lama dibiarkan
-- company_id NULL sehingga tetap terlihat oleh semua company.

/* -------------------------------------------------------------------------- */
/* 1. contract_terms                                                          */
/* -------------------------------------------------------------------------- */

-- Urutan termin unik per proyek: mencegah dua termin menempati slot yang sama
-- saat UI menyimpan daftar sekaligus (idempoten, aman untuk data lama).
CREATE UNIQUE INDEX IF NOT EXISTS contract_terms_project_sort_idx
  ON contract_terms (company_id, project_id, sort_order);

CREATE INDEX IF NOT EXISTS contract_terms_project_idx
  ON contract_terms (company_id, project_id, type);

ALTER TABLE contract_terms ADD COLUMN IF NOT EXISTS notes text;

-- Termin dengan status CLOSED tidak boleh kembali OPEN karena perubahan nominal.
CREATE OR REPLACE FUNCTION trg_contract_terms_status_recalc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Status CLOSED adalah keputusan manual; jangan ditimpa otomatis.
  IF NEW.status = 'CLOSED' THEN RETURN NEW; END IF;
  -- 0007: termin yang sudah ditagihkan penuh tidak boleh turun status karena
  -- nominal diperbesar (invoiced < amount) — statusnya menunggu penagihan lanjut.
  NEW.status := CASE
    WHEN COALESCE(NEW.invoiced_amount, 0) <= 0 THEN 'OPEN'
    WHEN COALESCE(NEW.amount, 0) > 0 AND NEW.invoiced_amount >= NEW.amount THEN 'INVOICED'
    ELSE 'PARTIALLY_INVOICED' END;
  RETURN NEW;
END $$;

/* -------------------------------------------------------------------------- */
/* 2. Katalog kategori biaya & satuan per company                             */
/* -------------------------------------------------------------------------- */

-- UNIQUE global (code) warisan skema pra-S1 membuat company B tidak bisa memakai
-- kode kategori/satuan yang sudah dipakai company A.
DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_categories', 'units'] LOOP
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
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_code_key');
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_code_unique');
  END LOOP;
END $$;

-- NULL = katalog bersama (dipakai semua company). Partial unique index hanya
-- berlaku untuk baris milik company sehingga katalog bersama tidak bentrok.
CREATE UNIQUE INDEX IF NOT EXISTS cost_categories_company_code_idx
  ON cost_categories (company_id, code) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS units_company_code_idx
  ON units (company_id, code) WHERE company_id IS NOT NULL;

ALTER TABLE cost_categories ADD COLUMN IF NOT EXISTS created_by_id text REFERENCES users(id);
ALTER TABLE units ADD COLUMN IF NOT EXISTS created_by_id text REFERENCES users(id);
ALTER TABLE cost_categories ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE units ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
