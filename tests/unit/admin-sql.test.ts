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

  it("idempoten: insert users & memberships memakai ON CONFLICT", () => {
    const inserts = template.match(/insert into \w+/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    expect(template).toContain("on conflict (email) do update");
    expect(template).toContain("on conflict (company_id, user_id) do update");
    // Company sengaja memakai `where not exists`, bukan ON CONFLICT.
    expect(template).toContain("where not exists (select 1 from companies)");
  });

  it("bila menulis audit, GUC company diset lebih dulu", () => {
    /* Berkas ini sengaja TIDAK menulis activity_logs: `company_id` NOT NULL
       + RLS membuat insert audit rapuh pada SQL Editor, sementara tabelnya
       sendiri belum tentu ada. Bila suatu saat ditambahkan, GUC wajib lebih dulu. */
    const guc = template.indexOf("set_config('app.current_company_id'");
    const audit = template.indexOf("insert into activity_logs");
    expect(audit).toBe(-1);
    expect(guc).toBe(-1);
  });

  /**
   * Dua bug yang ditemukan saat menguji terhadap skema database yang nyata:
   * 1. `activity_logs.id` bertipe text TANPA default → insert tanpa id gagal
   *    dengan "null value in column id";
   * 2. company baru dibuat padahal data sudah ada di company lain → admin
   *    masuk ke tenant kosong dan tidak melihat proyek apa pun.
   */
  it("tidak menulis activity_logs (kolom id tanpa default + RLS → rapuh di SQL Editor)", () => {
    expect(template).not.toContain("insert into activity_logs");
  });

  it("tidak membuat company baru bila company sudah ada", () => {
    expect(template).toContain("where not exists (select 1 from companies)");
    // Keanggotaan harus menempel ke company tertua, bukan ke slug yang baru dibuat.
    expect(template).toContain("order by created_at, id limit 1");
  });

  it("tidak memakai kolom migrasi 0010 di SQL yang dieksekusi", () => {
    // Blok komentar boleh menyebut kolom 0010 sebagai catatan; pernyataan SQL tidak.
    const statements = template.split("\n").filter((line) => !line.trimStart().startsWith("--"));
    expect(statements.join("\n")).not.toContain("failed_login_count");
    expect(statements.join("\n")).not.toContain("locked_until");
  });

  it("memakai placeholder yang jelas, bukan email contoh yang bisa tertinggal", () => {
    for (const placeholder of ["__EMAIL__", "__NAME__", "__COMPANY__", "__SLUG__", "__HASH__", "__DEMO_HASH__"]) {
      expect(template).toContain(placeholder);
    }
  });
});
