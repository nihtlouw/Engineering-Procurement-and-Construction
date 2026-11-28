-- S3 · Field Photos: metadata foto lapangan di DB, bytes di object storage.
-- Dijalankan SETELAH 0000 + 0001 + 0002 + 0003 oleh scripts/migrate.ts
-- dalam SATU transaksi. Forward-only, tanpa down script.
--
-- Prinsip:
--  * file lama tetap memakai file_objects.content_base64 ('DB').
--  * foto baru TIDAK menyimpan base64 di DB: provider LOCAL (dev/test)
--    atau S3 (production), dan content_base64 NULL.
--  * field_photos + document_photo_links mendapat ENABLE + FORCE RLS.

/* -------------------------------------------------------------------------- */
/* 1. Metadata storage pada file_objects                                      */
/* -------------------------------------------------------------------------- */

ALTER TABLE file_objects ALTER COLUMN content_base64 DROP NOT NULL;
ALTER TABLE file_objects ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'DB';
ALTER TABLE file_objects ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE file_objects ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE file_objects ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE file_objects ADD COLUMN IF NOT EXISTS original_size_bytes integer;

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_objects_storage_provider_valid') THEN
    ALTER TABLE file_objects
      ADD CONSTRAINT file_objects_storage_provider_valid
      CHECK (storage_provider IN ('DB', 'LOCAL', 'S3')) NOT VALID;
  END IF;
END $mig$;
CREATE INDEX IF NOT EXISTS file_objects_provider_idx ON file_objects (company_id, storage_provider);

/* -------------------------------------------------------------------------- */
/* 2. Foto lapangan & lampiran dokumen                                        */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS field_photos (
  id                      text PRIMARY KEY,
  company_id              uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  project_id              text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id                 text NOT NULL REFERENCES file_objects(id) ON DELETE RESTRICT,
  category                text NOT NULL,
  captured_at             date NOT NULL,
  description             text,
  location_label          text,
  is_selected_for_report  boolean NOT NULL DEFAULT false,
  sort_order              integer NOT NULL DEFAULT 0,
  uploaded_by_id          text NOT NULL REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_photos_category_valid CHECK (category IN ('BEFORE', 'PROCESS', 'AFTER')),
  CONSTRAINT field_photos_file_unique UNIQUE (company_id, file_id)
);
CREATE INDEX IF NOT EXISTS field_photos_project_date_idx
  ON field_photos (company_id, project_id, captured_at, category);
CREATE INDEX IF NOT EXISTS field_photos_selected_idx
  ON field_photos (company_id, project_id, is_selected_for_report);

CREATE TABLE IF NOT EXISTS document_photo_links (
  id              text PRIMARY KEY,
  company_id      uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  document_id     text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_photo_id  text NOT NULL REFERENCES field_photos(id) ON DELETE CASCADE,
  sort_order      integer NOT NULL DEFAULT 0,
  selected_by_id  text NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_photo_links_unique UNIQUE (document_id, field_photo_id)
);
CREATE INDEX IF NOT EXISTS document_photo_links_document_idx
  ON document_photo_links (company_id, document_id, sort_order);

/* -------------------------------------------------------------------------- */
/* 3. Integritas company/project                                              */
/* -------------------------------------------------------------------------- */

CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_idx ON projects (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS file_objects_company_id_idx ON file_objects (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_company_id_idx ON documents (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS field_photos_company_id_idx ON field_photos (company_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS document_photo_links_company_id_idx ON document_photo_links (company_id, id);

DO $$
BEGIN
  BEGIN
    ALTER TABLE field_photos ADD CONSTRAINT field_photos_project_company_fk
      FOREIGN KEY (company_id, project_id) REFERENCES projects (company_id, id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE field_photos ADD CONSTRAINT field_photos_file_company_fk
      FOREIGN KEY (company_id, file_id) REFERENCES file_objects (company_id, id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE document_photo_links ADD CONSTRAINT document_photo_links_document_company_fk
      FOREIGN KEY (company_id, document_id) REFERENCES documents (company_id, id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE document_photo_links ADD CONSTRAINT document_photo_links_photo_company_fk
      FOREIGN KEY (company_id, field_photo_id) REFERENCES field_photos (company_id, id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION assert_document_photo_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_doc_project text;
  v_photo_project text;
BEGIN
  SELECT project_id INTO v_doc_project FROM documents WHERE id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen % tidak ditemukan', NEW.document_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT project_id INTO v_photo_project FROM field_photos WHERE id = NEW.field_photo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foto % tidak ditemukan', NEW.field_photo_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc_project IS DISTINCT FROM v_photo_project THEN
    RAISE EXCEPTION 'Foto dan dokumen harus berasal dari proyek yang sama.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS document_photo_links_scope ON document_photo_links;
CREATE TRIGGER document_photo_links_scope
  BEFORE INSERT OR UPDATE OF document_id, field_photo_id ON document_photo_links
  FOR EACH ROW EXECUTE FUNCTION assert_document_photo_scope();

/* -------------------------------------------------------------------------- */
/* 4. RLS untuk 2 tabel baru (tabel bisnis ke-29 & ke-30)                     */
/* -------------------------------------------------------------------------- */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_photos', 'document_photo_links'] LOOP
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

-- Catatan: `{{#photos}}` untuk S4 disiapkan lewat document_photo_links.
-- Blok PDF memakai file_id, bukan URL presigned yang kedaluwarsa, agar FINAL
-- tetap dapat dirender ulang dari metadata storage yang immutable.
