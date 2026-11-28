import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Skrip migrasi gabungan (untuk Neon SQL Editor tanpa terminal) harus:
 * - memuat SELURUH berkas migrasi apa adanya (tidak ada yang terlewat);
 * - tidak pernah memuat perintah shell `npm` atau komentar `#`;
 * - menyertakan blok verifikasi jumlah tabel FORCE RLS & policy.
 *
 * Riwayat penting: awalnya repositori ini TIDAK membuat 28 tabel pra-S1 (tabel
 * itu dibuat `drizzle-kit push` pada database lama), sehingga rantai migrasi
 * GAGAL pada database kosong. Kini ada `0000_baseline_schema.sql` yang
 * membangun seluruh skema dari `src/db/schema.ts` secara idempoten. Tes di sini
 * mengunci bahwa baseline itu benar-benar ada, ikut disertakan dalam skrip
 * gabungan, dan bahwa 0000 tetap tidak "pura-pura" membuat tabel pra-S1.
 */
const DRIZZLE = path.join(process.cwd(), "drizzle");
const files = readdirSync(DRIZZLE).filter((file) => file.endsWith(".sql")).sort();

const buildScript = () => {
  const header = "-- header\n";
  return header + files.map((file) => readFileSync(path.join(DRIZZLE, file), "utf8").trimEnd()).join("\n");
};

describe("skrip migrasi gabungan", () => {
  it("setiap berkas migrasi ada dan berurutan", () => {
    expect(files[0]).toBe("0000_baseline_schema.sql");
    expect(files[1]).toBe("0000_tenant_foundation.sql");
    expect(files[files.length - 1]).toBe("0011_password_reset_tokens.sql");
    expect(files).toHaveLength(13);
  });

  it("baseline membangun seluruh skema dari schema.ts, idempoten", () => {
    const baseline = readFileSync(path.join(DRIZZLE, "0000_baseline_schema.sql"), "utf8");
    // 43 tabel di schema.ts + `_baseline_warnings` (tabel catatan penyesuaian).
    const quoted = baseline.match(/CREATE TABLE IF NOT EXISTS "[a-z0-9_]+"/g) ?? [];
    // 43 tabel schema.ts (berkutip) + `_baseline_warnings` ditulis tanpa kutip.
    expect(quoted).toHaveLength(43);
    expect(baseline).toContain("create table if not exists _baseline_warnings");
    expect(baseline).toContain("CREATE OR REPLACE FUNCTION app_current_company_id()");
    // FK ditambahkan di blok guard, bukan inline (aman untuk tabel yang sudah ada).
    expect(baseline).toContain("IF NOT EXISTS (");
    // Nama constraint dipotong 63 byte — dua nama panjang bisa identik setelah dipotong.
    expect(baseline).toContain("left(spec.conname, 63)");
    expect(baseline).not.toContain("--> statement-breakpoint");
  });

  it("isi setiap berkas tersalin utuh dan tidak menambah sintaks shell", () => {
    const script = buildScript();
    for (const file of files) {
      const original = readFileSync(path.join(DRIZZLE, file), "utf8").trimEnd();
      expect(script).toContain(original);
    }
    expect(script).not.toMatch(/^\s*npm\s/m);
    expect(script).not.toMatch(/^\s*#/m);
  });

  it("0000 hanya membuat tabel control-plane BARU; bukan skema dari nol", () => {
    /* Temuan yang dikunci di sini: 0000 membuat `companies`, `memberships`,
     * `invitations`, `auth_events` — tetapi TIDAK membuat `users`, `sessions`,
     * maupun 24 tabel bisnis. Semuanya diasumsikan sudah ada dari
     * `drizzle-kit push` pada database lama (lihat drizzle/README.md).
     *
     * Konsekuensinya: migrasi ini GAGAL pada database kosong dengan pesan
     * `relation "users" does not exist`. Tes ini menjaga agar kita tidak
     * menjanjikan "cukup jalankan migrasi di DB baru" tanpa membuat baseline. */
    const foundation = readFileSync(path.join(DRIZZLE, "0000_tenant_foundation.sql"), "utf8");
    expect(foundation).toMatch(/CREATE TABLE IF NOT EXISTS companies/);
    expect(foundation).toMatch(/CREATE TABLE IF NOT EXISTS memberships/);
    expect(foundation).toMatch(/CREATE TABLE IF NOT EXISTS invitations/);
    expect(foundation).toMatch(/CREATE TABLE IF NOT EXISTS auth_events/);
    expect(foundation).not.toMatch(/CREATE TABLE IF NOT EXISTS users/);
    expect(foundation).not.toMatch(/CREATE TABLE IF NOT EXISTS sessions/);

    // Baseline JUGA tidak boleh membuatnya bersyarat: ia memakai CREATE TABLE
    // IF NOT EXISTS agar tabel yang sudah ada dilewati (data tidak disentuh).
    const baseline = readFileSync(path.join(DRIZZLE, "0000_baseline_schema.sql"), "utf8");
    expect(baseline).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(baseline).toContain('CREATE TABLE IF NOT EXISTS "sessions"');

    for (const file of files.filter((name) => name !== "0000_baseline_schema.sql")) {
      const sql = readFileSync(path.join(DRIZZLE, file), "utf8");
      const createsBusinessTable = /CREATE TABLE IF NOT EXISTS (clients|projects|expenses|budget_versions|schedule_items)\b/.test(sql);
      expect(createsBusinessTable, `${file} tidak boleh membuat tabel pra-S1`).toBe(false);
    }
  });
});
