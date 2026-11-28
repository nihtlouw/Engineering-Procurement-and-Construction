/**
 * Menghasilkan SATU skrip SQL berisi seluruh migrasi `drizzle/*.sql`, siap
 * ditempel ke SQL Editor Neon (atau dijalankan psql) tanpa terminal/Node.
 *
 *   npm run db:migrate:sql > migrate.sql
 *   npm run db:migrate:sql -- --from 0005 > migrate.sql   # hanya 0005 ke atas
 *
 * Kenapa ada: `npm run db:migrate` butuh DATABASE_URL + Node. Bila satu-satunya
 * akses adalah dashboard Neon, skrip ini adalah padanan yang setara.
 *
 * Perbedaan penting dengan `scripts/migrate.ts`:
 * - runner Node mencatat kemajuan di `_migrations` dan menghentikan kesalahan;
 * - skrip SQL ini TIDAK memakai `_migrations` (Neon SQL Editor menjalankan
 *   seluruh isinya sebagai satu batch). Karena itu setiap berkas diharapkan
 *   idempoten (`IF NOT EXISTS`, `DO $$`, `CREATE OR REPLACE`). Bila satu
 *   pernyataan gagal, periksa pesannya lalu jalankan ulang — yang sudah
 *   diterapkan akan dilewati karena idempoten.
 * - Skrip sengaja TIDAK membungkus semuanya dalam satu transaksi: beberapa
 *   migrasi memakai `CREATE INDEX CONCURRENTLY`-style DDL dan komentar panjang;
 *   menjalankan per berkas lebih mudah didiagnosis bila ada yang gagal.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "drizzle");

function parseFrom(argv: string[]) {
  const index = argv.findIndex((arg) => arg === "--from");
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith("--from="));
  return inline ? inline.slice("--from=".length) : null;
}

function main() {
  const from = parseFrom(process.argv.slice(2));
  const files = readdirSync(DIR).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) throw new Error("Tidak ada file .sql di folder drizzle/.");

  const selected = from ? files.filter((file) => file >= from) : files;
  if (!selected.length) throw new Error(`Tidak ada migrasi >= ${from}.`);

  const out: string[] = [
    "-- ===========================================================================",
    "-- Skrip migrasi gabungan — dihasilkan oleh `npm run db:migrate:sql`.",
    "--",
    "-- CARA PAKAI (tanpa terminal, hanya dashboard Neon):",
    "--   1. Neon Console -> project Anda -> SQL Editor",
    "--   2. Tempel SELURUH isi berkas ini, lalu Run",
    "--   3. Setelah selesai, jalankan bagian VERIFIKASI di paling bawah",
    "--",
    `-- Berisi ${selected.length} migrasi: ${selected[0]} .. ${selected[selected.length - 1]}`,
    "--",
    "-- PENTING: jangan menambahkan perintah shell (`npm ...`) atau komentar `#`",
    "-- ke berkas ini. SQL hanya mengenal komentar `--` dan `/* */`.",
    "-- ===========================================================================",
    "",
    "create table if not exists _migrations (",
    "  name text primary key,",
    "  applied_at timestamptz not null default now()",
    ");",
    "",
  ];

  for (const file of selected) {
    const sql = readFileSync(path.join(DIR, file), "utf8").trimEnd();
    out.push(
      "-- ---------------------------------------------------------------------------",
      `-- ${file}`,
      "-- ---------------------------------------------------------------------------",
      sql,
      "",
    );
  }

  out.push(
    "-- ---------------------------------------------------------------------------",
    "-- VERIFIKASI (jalankan terpisah setelah skrip di atas sukses)",
    "-- ---------------------------------------------------------------------------",
    "-- 1. Catat migrasi yang sudah diterapkan:",
    ...selected.map((file) => `insert into _migrations (name) values ('${file}') on conflict (name) do nothing;`),
    "",
    "-- 2. Jumlah tabel yang diharapkan: 34 tabel FORCE RLS + 136 policy.",
    "select",
    "  (select count(*) from pg_class c",
    "     join pg_namespace n on n.oid = c.relnamespace",
    "    where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity) as tabel_force_rls,",
    "  (select count(*) from pg_policy) as jumlah_policy,",
    "  (select count(*) from information_schema.tables",
    "    where table_schema = 'public') as jumlah_tabel;",
    "",
  );

  process.stdout.write(out.join("\n"));
  process.stderr.write(`\n${selected.length} migrasi digabung (${selected[0]} .. ${selected[selected.length - 1]}).\n`);
  process.stderr.write("Tempel hasilnya ke Neon SQL Editor, atau: npm run db:migrate:sql > migrate.sql\n");
}

main();
