/**
 * Membangun ulang `drizzle/0000_baseline_schema.sql` dari `src/db/schema.ts`.
 *
 *   npm run db:baseline            # tulis berkas
 *   npm run db:baseline -- --check # hanya periksa apakah berkas masih sinkron
 *
 * Kenapa perlu dihasilkan, bukan ditulis tangan: skema punya 43 tabel dan
 * ratusan kolom. Berkas yang ditulis tangan akan menyimpang dari schema.ts
 * tanpa ada yang menyadarinya. Skrip ini memakai `drizzle-kit generate` (sumber
 * yang sama dengan migrasi) lalu menambahkan tiga hal yang tidak diberikan
 * drizzle-kit:
 *
 * 1. `IF NOT EXISTS` pada CREATE TABLE/INDEX, agar aman pada database yang
 *    sudah berisi data.
 * 2. Kunci asing dipindah ke satu blok `DO` yang memeriksa keberadaan
 *    constraint DAN keberadaan kolomnya (FK ke kolom yang belum ada dilewati
 *    dan dicatat, bukan menggagalkan migrasi).
 * 3. Penambal kolom: untuk tabel yang SUDAH ada, kolom yang belum ada
 *    ditambahkan (tanpa NOT NULL) supaya migrasi berikutnya tidak gagal dengan
 *    "column ... does not exist".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "drizzle/0000_baseline_schema.sql");
const DRIZZLE = path.resolve(process.cwd(), "drizzle");

function generate(): string {
  // drizzle-kit memakai folder `out` bila tidak pandai menaruh berkas; arahkan
  // ke folder sementara agar `drizzle/` tidak terisi berkas bernomor duplikat.
  const staging = mkdtempSync(path.join(tmpdir(), "epc-baseline-"));
  const before = new Set(readdirSync(DRIZZLE));
  // Parameter eksplisit: `--out` saja membuat drizzle-kit kehilangan
  // schema/dialect dari drizzle.config.ts (terverifikasi).
  execFileSync("npx", [
    "drizzle-kit", "generate", "--name", "baseline_autogen",
    "--out", staging,
    "--schema", "./src/db/schema.ts",
    "--dialect", "postgresql",
  ], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgres://baseline@localhost/baseline" },
  });
  const created = readdirSync(staging).filter((file) => file.endsWith(".sql"));
  if (created.length !== 1) {
    throw new Error(`Harapan 1 berkas baru dari drizzle-kit, dapat: ${created.join(", ") || "tidak ada"}`);
  }
  const source = readFileSync(path.join(staging, created[0]!), "utf8");
  rmSync(staging, { recursive: true, force: true });
  return source;
}

/** Mengubah keluaran drizzle-kit menjadi baseline idempoten. */
export function transform(source: string): string {
  let body = source
    .replace(/ALTER TABLE "[a-z0-9_]+" ADD CONSTRAINT "[a-z0-9_]+" FOREIGN KEY [^;]*;[ \t]*\r?\n?/gi, "")
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "');
  body = body.replace(/CREATE UNIQUE INDEX "/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "');
  body = body.replace(/CREATE INDEX "/g, 'CREATE INDEX IF NOT EXISTS "');
  body = body.replace(/--> statement-breakpoint/g, "");

  /* Kumpulkan FK. drizzle-kit dapat menuliskannya dalam DUA bentuk:
     (a) inline di dalam CREATE TABLE:  , CONSTRAINT "x" FOREIGN KEY (...) REFERENCES ...
     (b) ALTER TABLE ... ADD CONSTRAINT "x" FOREIGN KEY ...
     Keduanya harus ditangani; bentuk (a) sempat terlewat sehingga blok FK
     kosong dan menghasilkan "syntax error at or near )" pada VALUES kosong. */
  type Fk = { table: string; name: string; clause: string };
  const fks: Fk[] = [];
  // Diambil dari `source` (mentah): transformasi CREATE TABLE di bawah dapat
  // menghapus teks sehingga FK terlewat.
  /* `REFERENCES` memakai nama berkualifikasi DAN berkutip: "public"."users".
     Bagian skema harus opsional dan memperhitungkan tanda kutipnya
     (`(?:"[a-z_]+"\.)?`). Dengan pola tanpa kutip, FK tidak terdeteksi sama
     sekali sehingga blok guard kosong — sempat terjadi dan diverifikasi. */
  const FK_PATTERN = /ALTER TABLE "([a-z0-9_]+)" ADD CONSTRAINT "([a-z0-9_]+)" (FOREIGN KEY \([^)]*\) REFERENCES (?:"[a-z_]+"\.)?"[^"]+"\([^)]*\)[^;]*);/gi;
  for (const match of source.matchAll(FK_PATTERN)) {
    fks.push({ table: match[1]!, name: match[2]!, clause: match[3]!.trim() });
  }
  if (new Set(fks.map((fk) => fk.name)).size !== fks.length) {
    throw new Error("Nama constraint FK duplikat di sumber drizzle-kit.");
  }
  // Hapus pernyataan FK dari body: dibangun ulang di blok guard.
  body = body.replace(
    /ALTER TABLE "[a-z0-9_]+" ADD CONSTRAINT "[a-z0-9_]+" FOREIGN KEY [^;]*;[ \t]*\r?\n?/gi,
    "",
  );
  // Penyisipan pertama body = source.replace(...) harus memakai pola yang sama.
  // Bentuk inline: hapus dari CREATE TABLE, simpan untuk blok guard.
  body = body.replace(/CREATE TABLE IF NOT EXISTS "([a-z0-9_]+)" \(([\s\S]*?)\n\);/gi, (whole, table: string, columns: string) => {
    const cleaned = columns.replace(
      /,?\s*\n?\s*CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \(([^)]*)\) REFERENCES "([^"]+)"\(([^)]*)\)([^,\n]*)/gi,
      (_m, name: string, cols: string, refTable: string, refCols: string, tail: string) => {
        fks.push({
          table,
          name,
          clause: `FOREIGN KEY (${cols}) REFERENCES "${refTable}"(${refCols})${tail.trim() ? ` ${tail.trim()}` : ""}`,
        });
        return "";
      },
    );
    return `CREATE TABLE IF NOT EXISTS "${table}" (${cleaned.replace(/,\s*$/, "")}\n);`;
  });
  body = body.replace(/;;\s*\n/g, ";\n").replace(/\);\s*\n;\s*/g, ");\n").replace(/\n{3,}/g, "\n\n");

  // Kumpulkan kolom per tabel untuk blok penambal.
  type Col = { table: string; name: string; definition: string };
  const cols: Col[] = [];
  for (const match of body.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z0-9_]+)" \(([\s\S]*?)\n\);/gi)) {
    const table = match[1]!;
    for (const line of match[2]!.split("\n")) {
      const col = line.match(/^\s*"([a-z0-9_]+)"\s+(.*?),?\s*$/);
      if (!col) continue;
      const name = col[1]!;
      let definition = col[2]!.replace(/,\s*$/, "").trim();
      // Kolom turunan (GENERATED ... STORED) tidak bisa ditambal begitu saja.
      if (/GENERATED ALWAYS/i.test(definition)) continue;
      definition = definition.replace(/\s+NOT NULL(?=\s|$)/i, "").trim();
      definition = definition.replace(/\s+PRIMARY KEY(?=\s|$)/i, "").replace(/\s+UNIQUE(?=\s|$)/i, "").trim();
      if (!definition) continue;
      cols.push({ table, name, definition });
    }
  }

  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

  const fkRows = fks
    .map((fk) => `      (${quote(fk.table)}, ${quote(fk.name)}, ${quote(fk.clause)})`)
    .join(",\n");
  const colRows = cols
    .map((col) => `      (${quote(col.table)}, ${quote(col.name)}, ${quote(col.definition)})`)
    .join(",\n");

  return `-- ==========================================================================
-- BASELINE SKEMA PENUH (idempoten) — DIHASILKAN, JANGAN DIEDIT TANGAN.
--
-- Sumber: src/db/schema.ts melalui \`npm run db:baseline\` (drizzle-kit generate).
-- Kenapa ada: rantai 0000-0011 BERSIFAT INKREMENTAL. 0000_tenant_foundation
-- hanya menambah company_id/RLS pada tabel yang SUDAH ADA; ia tidak membuat
-- users, sessions, atau 24 tabel bisnis. Menjalankan rantai itu pada database
-- kosong selalu gagal (relation "users" does not exist) — terverifikasi.
--
-- Berkas ini membuat SELURUH skema sehingga database kosong menjadi utuh, dan
-- pada database yang SUDAH berisi data ia hanya menambah yang belum ada:
--   * tabel  -> CREATE TABLE IF NOT EXISTS (tabel lama dilewati, data utuh)
--   * kolom  -> blok PENAMBAL KOLOM (hanya kolom yang hilang)
--   * FK     -> blok terpisah, dilewati bila kolomnya belum ada (dicatat)
-- Semua penyesuaian dicatat di tabel \`_baseline_warnings\`; periksa setelah
-- menjalankan berkas ini.
--
-- Yang TIDAK dilakukan: seed data, dan RLS/policy (itu tugas 0001).
-- ==========================================================================

begin;

-- Fungsi pembantu GUC dipakai DEFAULT kolom di bawah, jadi harus dibuat lebih
-- dulu. Definisi identik dengan 0000_tenant_foundation.sql (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_company_id', true), '')::uuid
$$;

${body.trimEnd()}

-- Catatan penyesuaian baseline (FK dilewati, kolom ditambal).
create table if not exists _baseline_warnings (
  kind      text not null,
  object    text not null,
  detail    text not null,
  noted_at  timestamptz not null default now(),
  primary key (kind, object)
);

-- --------------------------------------------------------------------------
-- PENAMBAL KOLOM: tabel yang SUDAH ada tidak dibuat ulang oleh CREATE TABLE
-- IF NOT EXISTS, sehingga kolom yang belum pernah ada (mis. \`projects.stage\`)
-- tetap hilang dan migrasi berikutnya gagal "column ... does not exist".
-- Blok ini menambahkan kolom yang hilang TANPA menyentuh baris lama; setiap
-- penambalan dicatat di \`_baseline_warnings\`.
-- --------------------------------------------------------------------------
DO $repair$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
${colRows}
    ) AS t(tbl, colname, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = spec.tbl
                      AND column_name = spec.colname) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', spec.tbl, spec.colname, spec.definition);
        INSERT INTO _baseline_warnings (kind, object, detail)
        VALUES ('column_added', spec.tbl || '.' || spec.colname, spec.definition)
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN others THEN
        INSERT INTO _baseline_warnings (kind, object, detail)
        VALUES ('column_skipped', spec.tbl || '.' || spec.colname, SQLERRM)
        ON CONFLICT DO NOTHING;
      END;
    END IF;
  END LOOP;
END $repair$;

-- --------------------------------------------------------------------------
-- Kunci asing: ditambahkan TERPISAH, hanya bila belum ada, dan hanya bila
-- kolom yang dirujuk benar-benar ada. FK ke kolom yang belum ada DILEWATI dan
-- dicatat — bukan menggagalkan seluruh migrasi (database hasil skema lama).
-- --------------------------------------------------------------------------
${fks.length ? `DO $baseline$
DECLARE
  spec record;
  missing text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
${fkRows}
    ) AS t(tbl, conname, clause)
  LOOP
    SELECT string_agg(col, ', ') INTO missing
      FROM (
        SELECT trim(both ' "' FROM unnest(
                 string_to_array(substring(spec.clause from 'FOREIGN KEY \\(([^)]*)\\)'), ','))) AS col
      ) parts
     WHERE col <> ''
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND column_name = col);

    IF missing IS NOT NULL THEN
      INSERT INTO _baseline_warnings (kind, object, detail)
      VALUES ('fk_skipped', spec.conname, 'kolom belum ada: ' || missing)
      ON CONFLICT DO NOTHING;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = spec.tbl) THEN
      -- Tabel belum ada; biarkan (FK akan ditambahkan pada jalankan berikutnya).
      NULL;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = left(spec.conname, 63)
                         AND conrelid = to_regclass(format('public.%I', spec.tbl))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I ', spec.tbl, left(spec.conname, 63)) || spec.clause;
    END IF;
  END LOOP;
END $baseline$;` : "-- (tidak ada kunci asing yang perlu ditambahkan)"}

commit;
`;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const source = generate();
  const built = transform(source);
  if (checkOnly) {
    const current = readFileSync(OUT, "utf8");
    if (current !== built) {
      console.error("Baseline TIDAK sinkron dengan schema.ts. Jalankan: npm run db:baseline");
      process.exitCode = 1;
      return;
    }
    console.log("Baseline sinkron dengan schema.ts.");
    return;
  }
  writeFileSync(OUT, built);
  const tables = (built.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length;
  const colsCount = (built.match(/^      \('/gm) ?? []).length;
  console.log(`Baseline ditulis: ${tables} tabel, ${colsCount} baris penambal/FK.`);
}

if (process.argv[1]?.includes("build-baseline")) main();
