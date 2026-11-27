-- S5 (migrasi 0009): WBS + kurva-S (plan vs actual, Σ weight = 100%).
--
-- Empat bagian:
--   1. `schedule_items` menjadi WBS sungguhan: level, kode, bobot, komitmen,
--      kurva-S per periode. Item lama menjadi level 1 dengan kode turunan dari
--      `sort_order` sehingga tidak ada data yang hilang.
--   2. FK `budget_lines.wbs_item_id` dan `budget_phasing.wbs_item_id` ke
--      `schedule_items` (hook B7 yang sebelumnya hanya kolom teks).
--   3. `project_wbs_calendars`: bobot Σ 100% per (proyek, versi) opsional —
--      dipakai bila distribusi berat tidak sama dengan bobot 1/1 item.
--   4. Rekonsiliasi audit: aktivitas lama memakai object_type `SCHEDULE_ITEM`,
--      dokumen WBS memakai `WBS_ITEM`. Keduanya dipetakan ke satu tipe audit.
--
-- Forward-only, non-destruktif. Tanpa down script; tidak ada kolom yang dihapus.

/* -------------------------------------------------------------------------- */
/* 1. WBS pada schedule_items                                                 */
/* -------------------------------------------------------------------------- */

-- Hierarki: level 1 = ringkasan, level 2 = grup pekerjaan, level 3 = aktivitas.
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS is_summary boolean NOT NULL DEFAULT false;
-- Komitmen vendor (PO/PTK) per item: bobot kurva-S tidak hanya dari biaya aktual.
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS committed_amount numeric(18,2) NOT NULL DEFAULT 0;
-- Kurva-S: distribusi rencana per periode (minggu kalender, ISO week start).
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS planned_pct_per_period numeric(9,4);
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS parent_sort_order integer NOT NULL DEFAULT 0;

-- Backfill idempoten: item lama menjadi aktivitas level 1 dengan kode WBS-###.
-- `is_summary` sengaja dibiarkan false: item lama adalah aktivitas, bukan grup.
UPDATE schedule_items s
   SET planned_pct_per_period = 100
 WHERE s.planned_pct_per_period IS NULL;
UPDATE schedule_items s
   SET level = 1
 WHERE s.level IS NULL OR s.level < 1;
-- Kode level-1 lama memakai nomor urut per proyek (bukan per company) agar
-- tidak bentrok dengan unique index di bawah ketika satu company punya beberapa
-- item dengan sort_order sama.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY company_id, project_id ORDER BY sort_order, id) AS seq
    FROM schedule_items
   WHERE code IS NULL AND parent_id IS NULL
)
UPDATE schedule_items s
   SET code = 'WBS-' || lpad(ranked.seq::text, 3, '0')
  FROM ranked
 WHERE s.id = ranked.id;

-- Kode WBS unik per proyek (bisa sama di proyek berbeda / company berbeda).
CREATE UNIQUE INDEX IF NOT EXISTS schedule_items_project_code_idx
  ON schedule_items (company_id, project_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_items_project_level_idx
  ON schedule_items (company_id, project_id, level, sort_order);
CREATE INDEX IF NOT EXISTS schedule_items_parent_idx
  ON schedule_items (company_id, parent_id);

-- Bobot & progres tetap numeric range; CHECK baru aman untuk data lama (0..100).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_items_weight_range'
  ) THEN
    ALTER TABLE schedule_items
      ADD CONSTRAINT schedule_items_weight_range CHECK (weight >= 0 AND weight <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_items_progress_range'
  ) THEN
    ALTER TABLE schedule_items
      ADD CONSTRAINT schedule_items_progress_range CHECK (progress_pct >= 0 AND progress_pct <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_items_level_range'
  ) THEN
    ALTER TABLE schedule_items
      ADD CONSTRAINT schedule_items_level_range CHECK (level BETWEEN 1 AND 4);
  END IF;
END $$;

/* -------------------------------------------------------------------------- */
/* 2. Hook RAB → WBS (B7) untuk kurva-S dari sisi biaya                       */
/* -------------------------------------------------------------------------- */

DO $$
BEGIN
  -- FK hanya dipasang bila data lama bersih; kalau tidak, kolom tetap teks dan
  -- verifikasi melaporkan kondisi (tidak menggagalkan migrasi produksi).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_lines_wbs_fk'
  ) AND NOT EXISTS (
    SELECT 1 FROM budget_lines b
     WHERE b.wbs_item_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM schedule_items s WHERE s.id = b.wbs_item_id)
  ) THEN
    ALTER TABLE budget_lines
      ADD CONSTRAINT budget_lines_wbs_fk FOREIGN KEY (wbs_item_id) REFERENCES schedule_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_phasing_wbs_fk'
  ) AND NOT EXISTS (
    SELECT 1 FROM budget_phasing p
     WHERE p.wbs_item_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM schedule_items s WHERE s.id = p.wbs_item_id)
  ) THEN
    ALTER TABLE budget_phasing
      ADD CONSTRAINT budget_phasing_wbs_fk FOREIGN KEY (wbs_item_id) REFERENCES schedule_items(id) ON DELETE CASCADE;
  END IF;
END $$;

/* -------------------------------------------------------------------------- */
/* 3. Kalender proyek: Σ weight = 100 per versi                              */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS project_wbs_calendars (
  id                text PRIMARY KEY,
  company_id        uuid NOT NULL DEFAULT app_current_company_id() REFERENCES companies(id),
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version           integer NOT NULL DEFAULT 1,
  status            text NOT NULL DEFAULT 'DRAFT',
  -- Periode kurva-S: minggu pertama dan jumlah minggu (dihitung server).
  start_date        date,
  -- Σ bobot item level aktivitas (divalidasi service = 100 ± 0,01).
  total_weight      numeric(7,2) NOT NULL DEFAULT 0,
  item_count        integer NOT NULL DEFAULT 0,
  weighted_progress numeric(7,2) NOT NULL DEFAULT 0,
  note              text,
  locked_at         timestamptz,
  locked_by_id      text REFERENCES users(id),
  created_by_id     text REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_wbs_calendars_status_check CHECK (status IN ('DRAFT', 'LOCKED')),
  CONSTRAINT project_wbs_calendars_weight_check CHECK (total_weight >= 0 AND total_weight <= 100.01)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_wbs_calendars_version_idx
  ON project_wbs_calendars (company_id, project_id, version);

ALTER TABLE project_wbs_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_wbs_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation_select ON project_wbs_calendars;
CREATE POLICY company_isolation_select ON project_wbs_calendars FOR SELECT USING (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_insert ON project_wbs_calendars;
CREATE POLICY company_isolation_insert ON project_wbs_calendars FOR INSERT WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_update ON project_wbs_calendars;
CREATE POLICY company_isolation_update ON project_wbs_calendars FOR UPDATE USING (company_id = app_current_company_id()) WITH CHECK (company_id = app_current_company_id());
DROP POLICY IF EXISTS company_isolation_delete ON project_wbs_calendars;
CREATE POLICY company_isolation_delete ON project_wbs_calendars FOR DELETE USING (company_id = app_current_company_id());

/* -------------------------------------------------------------------------- */
/* 4. Rekonsiliasi tipe audit WBS                                            */
/* -------------------------------------------------------------------------- */

-- Aktivitas lama dicatat sebagai `SCHEDULE_ITEM`; WBS baru memakai `WBS_ITEM`.
-- Keduanya dibaca UI dengan label yang sama, jadi tidak ada backfill massal
-- yang mengubah jejak audit (append-only). Komentar ini menjadi rujukan.
COMMENT ON TABLE schedule_items IS
  'WBS & jadwal proyek. S5 (0009): hierarki level 1-4, kode WBS, bobot Σ100%, distribusi rencana per periode untuk kurva-S.';
COMMENT ON COLUMN schedule_items.planned_pct_per_period IS
  'Persen rencana yang diselesaikan pada periode (minggu) yang ditampilkan; dipakai kurva-S rencana.';
