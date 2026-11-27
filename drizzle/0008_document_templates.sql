-- S4 (migrasi 0008): template dokumen dikelola admin di DB, bukan hardcode kode.
--
-- Empat bagian:
--   1. `document_templates` + `document_template_variables`: definisi template,
--      varian per company, versi, blok bawaan, dan daftar variabel merge.
--   2. `documents`: template bisa kosong (dokumen unggahan), ditambah template
--      versi + nama beku, file DOCX hasil generate, dan status ARCHIVED.
--   3. `document_template_versions`: jejak versi (snapshot blok + DOCX) supaya
--      dokumen FINAL tetap dapat direproduksi walau template diubah kemudian.
--   4. Seed 11 template bawaan (company_id NULL = template sistem, read-only)
--      memakai blok yang sebelumnya hardcode di `src/lib/document-templates.ts`.
--
-- Forward-only, non-destruktif. Tanpa FORCE RLS pada tabel template: sama seperti
-- `cost_categories`/`units`, baris `company_id IS NULL` adalah milik bersama dan
-- isolasi ditegakkan filter eksplisit di service (lihat 0001 catatan desain).

/* -------------------------------------------------------------------------- */
/* 1. document_templates & document_template_variables                        */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS document_templates (
  id text PRIMARY KEY,
  -- NULL = template sistem (bawaan) yang boleh dipakai semua company.
  company_id uuid REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  -- Kategori arsip dokumen hasil template (BA, CONTRACT, OTHER, ...).
  category text NOT NULL DEFAULT 'OTHER',
  -- Kode template sumber untuk template varian company (NULL = mandiri).
  base_code text,
  version integer NOT NULL DEFAULT 1,
  -- `BLOCKS` = blok terstruktur (dirender PDF/DOCX oleh pdf-lib/docxtemplater),
  -- `DOCX` = berkas DOCX dengan placeholder {tag} milik admin.
  kind text NOT NULL DEFAULT 'BLOCKS',
  blocks jsonb,
  docx_file_id text REFERENCES file_objects(id),
  signature_parties jsonb,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by_id text REFERENCES users(id),
  updated_by_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_templates_kind_check CHECK (kind IN ('BLOCKS', 'DOCX'))
);

-- Kode unik per company; template sistem (company_id NULL) unik di antara dirinya.
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_company_code_idx
  ON document_templates (company_id, code) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_system_code_idx
  ON document_templates (code) WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS document_templates_company_active_idx
  ON document_templates (company_id, is_active, code);

CREATE TABLE IF NOT EXISTS document_template_variables (
  id text PRIMARY KEY,
  company_id uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  template_id text NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  tag text NOT NULL,
  label text NOT NULL,
  -- `TEXT` = string beku, `MONEY` = nominal, `DATE` = tanggal, `ROW_LIST` = tabel
  -- (dipakai placeholder {#rows}...{/rows}), `PHOTOS` = galeri foto terpilih.
  var_type text NOT NULL DEFAULT 'TEXT',
  -- Ekspresi pengambilan data saat snapshot: `project.code`, `client.legalName`,
  -- `invoice.totalAmount`, `schedule.rows`, `photos.selected`, dst.
  source text NOT NULL,
  sample_value text,
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_template_variables_type_check
    CHECK (var_type IN ('TEXT', 'MONEY', 'DATE', 'ROW_LIST', 'PHOTOS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS document_template_variables_tag_idx
  ON document_template_variables (template_id, tag);
CREATE INDEX IF NOT EXISTS document_template_variables_template_idx
  ON document_template_variables (company_id, template_id, sort_order);

/* -------------------------------------------------------------------------- */
/* 2. documents: template opsional, versi beku, DOCX hasil generate           */
/* -------------------------------------------------------------------------- */

ALTER TABLE documents ALTER COLUMN template_code DROP NOT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS template_id text REFERENCES document_templates(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS template_name text;
-- Template admin bisa diubah setelah dokumen dibuat: simpan salinan agar FINAL
-- tetap dapat direproduksi dan audit tidak ambigu.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS template_snapshot jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS docx_file_id text REFERENCES file_objects(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archived_by_id text REFERENCES users(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS documents_template_idx ON documents (company_id, template_id);
CREATE INDEX IF NOT EXISTS documents_project_status_idx ON documents (company_id, project_id, status);

/* -------------------------------------------------------------------------- */
/* 3. document_template_versions                                             */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS document_template_versions (
  id text PRIMARY KEY,
  company_id uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  template_id text NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  blocks jsonb,
  docx_file_id text REFERENCES file_objects(id),
  variables jsonb,
  note text,
  created_by_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_template_versions_unique_idx
  ON document_template_versions (template_id, version);

-- RLS penuh: versi template adalah data operasional per company.
ALTER TABLE document_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_template_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation_select ON document_template_versions;
CREATE POLICY company_isolation_select ON document_template_versions FOR SELECT USING (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_insert ON document_template_versions;
CREATE POLICY company_isolation_insert ON document_template_versions FOR INSERT WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_update ON document_template_versions;
CREATE POLICY company_isolation_update ON document_template_versions FOR UPDATE USING (company_id = app_current_company_id()) WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_delete ON document_template_versions;
CREATE POLICY company_isolation_delete ON document_template_versions FOR DELETE USING (company_id = app_current_company_id());

-- `document_template_variables` juga FORCE RLS. Template sistem tidak punya
-- baris variabel global: varian company menyalin variabel yang dibutuhkannya.
ALTER TABLE document_template_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_template_variables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation_select ON document_template_variables;
CREATE POLICY company_isolation_select ON document_template_variables FOR SELECT USING (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_insert ON document_template_variables;
CREATE POLICY company_isolation_insert ON document_template_variables FOR INSERT WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_update ON document_template_variables;
CREATE POLICY company_isolation_update ON document_template_variables FOR UPDATE USING (company_id = app_current_company_id()) WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_delete ON document_template_variables;
CREATE POLICY company_isolation_delete ON document_template_variables FOR DELETE USING (company_id = app_current_company_id());

/* -------------------------------------------------------------------------- */
/* 4. Seed 11 template sistem (idempoten)                                     */
/* -------------------------------------------------------------------------- */

INSERT INTO document_templates (id, company_id, code, name, description, category, version, kind, is_system)
VALUES
  ('tpl-system-PROPOSAL_SPH', NULL, 'PROPOSAL_SPH', 'Surat Penawaran Harga', 'Surat resmi lingkup, harga, validitas, dan tanda tangan.', 'OTHER', 1, 'BLOCKS', true),
  ('tpl-system-RAB_CLIENT', NULL, 'RAB_CLIENT', 'RAB Penawaran', 'Rincian pos pekerjaan dan harga klien; tanpa biaya internal.', 'OTHER', 1, 'BLOCKS', true),
  ('tpl-system-BA_SURVEY', NULL, 'BA_SURVEY', 'BA Survei', 'Peserta, temuan site, risiko, dan asumsi teknis.', 'BA', 1, 'BLOCKS', true),
  ('tpl-system-BA_MOS', NULL, 'BA_MOS', 'BA Material On Site', 'Berita acara material utama tiba dan diperiksa di site.', 'BA', 1, 'BLOCKS', true),
  ('tpl-system-BA_COMMISSIONING', NULL, 'BA_COMMISSIONING', 'BA Uji / Commissioning', 'Parameter uji beban, hasil, dan persetujuan para pihak.', 'BA', 1, 'BLOCKS', true),
  ('tpl-system-BAST1', NULL, 'BAST1', 'BAST 1', 'Serah terima pekerjaan dan awal masa pemeliharaan.', 'BA', 1, 'BLOCKS', true),
  ('tpl-system-BAST2', NULL, 'BAST2', 'BAST 2', 'Serah terima akhir setelah masa pemeliharaan dan retensi.', 'BA', 1, 'BLOCKS', true),
  ('tpl-system-INVOICE', NULL, 'INVOICE', 'Invoice', 'Tagihan DPP, PPN, total, jatuh tempo, dan terbilang.', 'OTHER', 1, 'BLOCKS', true),
  ('tpl-system-KWITANSI', NULL, 'KWITANSI', 'Kwitansi', 'Bukti penerimaan pembayaran dengan potongan pajak.', 'OTHER', 1, 'BLOCKS', true),
  ('tpl-system-PROGRESS_REPORT', NULL, 'PROGRESS_REPORT', 'Laporan Progres Mingguan', 'Progres terbobot, capaian aktivitas, kendala, dan rencana.', 'OTHER', 1, 'BLOCKS', true),
  ('tpl-system-CHANGE_ORDER', NULL, 'CHANGE_ORDER', 'Change Order / Addendum', 'Perubahan lingkup, dampak harga, biaya, dan waktu.', 'OTHER', 1, 'BLOCKS', true)
ON CONFLICT (id) DO NOTHING;
