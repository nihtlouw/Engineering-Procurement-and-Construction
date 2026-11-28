import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SQL provisioning admin harus dapat ditempel apa adanya ke SQL Editor Neon.
 * Dua kesalahan yang pernah terjadi dan dikunci oleh tes ini:
 * 1. menempel perintah `npm run …` (bukan SQL);
 * 2. memakai `#` sebagai komentar (itu komentar shell, bukan SQL).
 */
const template = readFileSync(path.join(process.cwd(), "docs/runbook/sql/provision-admin.sql"), "utf8");

describe("SQL provisioning admin", () => {
  it("hanya berisi SQL: tidak ada perintah npm dan tidak ada komentar gaya shell", () => {
    expect(template).not.toMatch(/^\s*npm\s/m);
    expect(template).not.toMatch(/^\s*#/m);
    // Komentar yang sah untuk Postgres.
    expect(template).toMatch(/^--/m);
  });

  it("idempoten: setiap insert memakai ON CONFLICT", () => {
    const inserts = template.match(/insert into \w+/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    expect(template).toContain("on conflict (slug) do nothing");
    expect(template).toContain("on conflict (email) do update");
    expect(template).toContain("on conflict (company_id, user_id) do update");
  });

  it("menyetel GUC company sebelum menulis audit (activity_logs FORCE RLS)", () => {
    const guc = template.indexOf("set_config('app.current_company_id'");
    const audit = template.indexOf("insert into activity_logs");
    expect(guc).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(guc);
  });

  it("memakai placeholder yang jelas, bukan email contoh yang bisa tertinggal", () => {
    for (const placeholder of ["__EMAIL__", "__NAME__", "__COMPANY__", "__SLUG__", "__HASH__"]) {
      expect(template).toContain(placeholder);
    }
  });
});
