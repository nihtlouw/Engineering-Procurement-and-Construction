/**
 * Runner migrasi SQL berversi. Menggantikan `drizzle-kit push`.
 *
 *   npm run db:migrate            # terapkan semua yang belum tercatat
 *   npm run db:migrate -- --check # daftar migrasi tertunda, tanpa mengubah DB
 *
 * Setiap file dijalankan dalam SATU transaksi dan dicatat di _migrations,
 * sehingga gagal = rollback penuh (tidak ada setengah migrasi).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });

const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi. Salin .env.example ke .env.local.");
  const checkOnly = process.argv.includes("--check");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    if (!files.length) throw new Error("Tidak ada file .sql di folder drizzle/.");

    let pending = 0;
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
      if (applied.rowCount) { console.log(`  lewati  ${file}`); continue; }
      pending += 1;
      if (checkOnly) { console.log(`  tertunda ${file}`); continue; }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  terapkan ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migrasi ${file} gagal (rollback): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(checkOnly
      ? `\n${pending} migrasi tertunda.`
      : `\nSelesai. ${pending} migrasi diterapkan, ${files.length - pending} sudah ada.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
