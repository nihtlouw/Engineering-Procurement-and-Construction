import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Uji EKSEKUSI rantai migrasi (bukan hanya teksnya).
 *
 * Dua skenario nyata:
 * A. database KOSONG — dulu selalu gagal (`relation "users" does not exist`);
 * B. database berisi skema lama + data — skema lama tidak punya kolom yang
 *    kemudian ditambahkan migrasi (mis. `projects.stage`), sehingga 0002 gagal.
 *
 * Tes ini mengunci bahwa keduanya kini lolos, dan bahwa mode `--fresh`
 * benar-benar menghapus lalu membangun ulang.
 */
const DRIZZLE = path.join(process.cwd(), "drizzle");
const files = readdirSync(DRIZZLE).filter((file) => file.endsWith(".sql")).sort();

/** Menjalankan seluruh berkas sesuai urutan nama (mirip `migrate-sql.ts`). */
async function runChain(db: PGlite) {
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(DRIZZLE, file), "utf8"));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function tableCount(db: PGlite) {
  const result = await db.query<{ n: number }>(
    // Hanya tabel dasar: `audit_logs` adalah VIEW (bukan tabel).
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name not in ('_migrations', '_baseline_warnings')`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function forcedRlsCount(db: PGlite) {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from pg_class c
       join pg_namespace nm on nm.oid = c.relnamespace
      where nm.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

let db: PGlite | null = null;
afterEach(async () => { await db?.close(); db = null; });

describe("rantai migrasi pada database KOSONG", () => {
  it("membangun seluruh 43 tabel + RLS tanpa satu pun error", async () => {
    db = new PGlite();
    await runChain(db);
    // 43 tabel schema.ts (+ _migrations, tidak dihitung).
    expect(await tableCount(db)).toBe(43);
    expect(await forcedRlsCount(db)).toBe(33);
  }, 120_000);

  it("aman dijalankan dua kali (idempoten)", async () => {
    db = new PGlite();
    await runChain(db);
    await runChain(db);
    expect(await tableCount(db)).toBe(43);
  }, 120_000);
});

describe("rantai migrasi pada database LAMA berisi data", () => {
  it("tidak gagal karena kolom company_id sudah ada (0000 tanpa IF NOT EXISTS)", async () => {
    db = new PGlite();
    // Skema versi lama: company_id SUDAH ada, tetapi kolom S2a+ belum.
    await db.exec(`
      create table users (id text primary key, name text, email text unique, password_hash text,
        role text, title text, is_active boolean default true, created_at timestamptz default now());
      create table companies (id uuid primary key default gen_random_uuid(), slug text unique,
        name text, legal_name text, created_at timestamptz default now());
      create table projects (id text primary key, company_id uuid, code text, title text);
      create table clients (id text primary key, company_id uuid, code text, legal_name text);
      insert into companies (slug, name, legal_name) values ('demo', 'Demo', 'Demo');
      insert into users (id, name, email, password_hash, role, title)
        values ('u1', 'Lama', 'lama@x.id', 'x', 'ADMIN', 'Adm');
    `);
    await runChain(db);
    // Data lama harus TETAP ada — migrasi menambah, bukan mengganti.
    const users = await db.query<{ n: number }>("select count(*)::int as n from users");
    expect(Number(users.rows[0]?.n)).toBe(1);
    expect(await tableCount(db)).toBe(43);
  }, 120_000);
});

describe("reset skema (mode --fresh)", () => {
  it("menghapus seluruh objek skema public lalu bisa dibangun ulang", async () => {
    db = new PGlite();
    await runChain(db);
    expect(await tableCount(db)).toBe(43);

    const reset = readFileSync(path.join(process.cwd(), "scripts/sql/reset-schema.sql"), "utf8")
      .replace(/^begin;$/m, "")
      .replace(/^commit;$/m, "");
    await db.exec(reset);
    expect(await tableCount(db)).toBe(0);

    // Bangun ulang dari nol: satu-satunya jalur yang bekerja untuk database yang
    // skemanya tidak pernah cocok dengan rantai migrasi.
    await runChain(db);
    expect(await tableCount(db)).toBe(43);
  }, 120_000);
});
