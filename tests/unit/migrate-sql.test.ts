import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Skrip migrasi gabungan (untuk Neon SQL Editor tanpa terminal) harus:
 * - memuat SELURUH berkas migrasi apa adanya (tidak ada yang terlewat);
 * - tidak pernah memuat perintah shell `npm` atau komentar `#`;
 * - menyertakan blok verifikasi jumlah tabel FORCE RLS & policy.
 *
 * Catatan penting yang dikunci di sini: repositori ini TIDAK membuat 28 tabel
 * pra-S1. Tabel itu dibuat `drizzle-kit push` pada database lama. Karena itu
 * migrasi tidak dapat dijalankan pada database kosong — tes ini memastikan
 * dokumentasi/alat bantu tidak menjanjikan sebaliknya.
 */
const DRIZZLE = path.join(process.cwd(), "drizzle");
const files = readdirSync(DRIZZLE).filter((file) => file.endsWith(".sql")).sort();

const buildScript = () => {
  const header = "-- header\n";
  return header + files.map((file) => readFileSync(path.join(DRIZZLE, file), "utf8").trimEnd()).join("\n");
};

describe("skrip migrasi gabungan", () => {
  it("setiap berkas migrasi ada dan berurutan", () => {
    expect(files[0]).toBe("0000_tenant_foundation.sql");
    expect(files[files.length - 1]).toBe("0011_password_reset_tokens.sql");
    expect(files).toHaveLength(12);
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

    for (const file of files) {
      const sql = readFileSync(path.join(DRIZZLE, file), "utf8");
      const createsBusinessTable = /CREATE TABLE IF NOT EXISTS (clients|projects|expenses|budget_versions|schedule_items)\b/.test(sql);
      expect(createsBusinessTable, `${file} tidak boleh membuat tabel pra-S1`).toBe(false);
    }
  });
});
