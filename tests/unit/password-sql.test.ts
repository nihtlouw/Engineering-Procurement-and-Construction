import { describe, expect, it } from "vitest";
import { buildResetSql, hasLockColumns } from "../../scripts/hash-password";
import { DEMO_EMAILS, assertStrong, parseArgs } from "../../scripts/set-passwords";

/**
 * SQL reset password harus jalan di DUA versi skema: sebelum dan sesudah
 * migrasi 0010. Ini bukan kasus teoretis — database yang di-audit memang belum
 * punya kolom `failed_login_count`/`locked_until`, dan justru database itulah
 * yang butuh reset darurat.
 */
describe("buildResetSql", () => {
  const hash = "0123456789abcdef:0123456789abcdef";

  it("menormalkan email: huruf kecil, tanpa spasi, satu argumen boleh berisi koma", () => {
    const sql = buildResetSql(["Admin@Ardaya.id", " PM@ardaya.id , Estimator@Ardaya.id "], hash);
    expect(sql).toContain("('admin@ardaya.id', 'pm@ardaya.id', 'estimator@ardaya.id')");
    expect(sql).not.toContain("Ardaya");
  });

  it("meng-escape tanda kutip agar email tidak bisa menyuntik SQL", () => {
    const sql = buildResetSql(["o'brien@example.com"], hash);
    expect(sql).toContain("'o''brien@example.com'");
  });

  it("reset kunci login dibungkus pemeriksaan kolom (tidak gagal di skema pra-0010)", () => {
    const sql = buildResetSql(["a@b.c"], hash);
    const guard = sql.indexOf("information_schema.columns");
    const lockUpdate = sql.indexOf("failed_login_count = 0");
    expect(guard).toBeGreaterThan(-1);
    expect(lockUpdate).toBeGreaterThan(guard);
    // Tidak boleh ada UPDATE yang menyebut kolom 0010 di luar blok penjaga.
    const beforeGuard = sql.slice(0, guard);
    expect(beforeGuard).not.toContain("failed_login_count");
    expect(beforeGuard).not.toContain("locked_until");
  });

  it("mencabut seluruh sesi milik akun yang direset", () => {
    const sql = buildResetSql(["a@b.c"], hash);
    expect(sql).toContain("delete from sessions");
    expect(sql).toContain("select id from users where email in");
  });

  it("satu transaksi: begin di awal, commit di akhir", () => {
    const sql = buildResetSql(["a@b.c"], hash).trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
  });
});

describe("hasLockColumns", () => {
  it("false bila kolom locked_until belum ada", async () => {
    expect(await hasLockColumns(async () => ({ rows: [] }))).toBe(false);
  });

  it("true bila information_schema mengembalikan kolomnya", async () => {
    expect(await hasLockColumns(async () => ({ rows: [{ column_name: "locked_until" }] }))).toBe(true);
  });

  it("aman bila hasil query tidak berbentuk { rows }", async () => {
    expect(await hasLockColumns(async () => undefined)).toBe(false);
  });
});

describe("set-passwords (penyiapan password massal)", () => {
  it("daftar akun demo adalah 6 alamat yang benar-benar ada di database", () => {
    // Dikunci agar reset massal tidak diam-diam melewatkan/menambah akun.
    expect([...DEMO_EMAILS].sort()).toEqual([
      "admin@ardaya.id", "estimator@ardaya.id", "field@ardaya.id",
      "finance@ardaya.id", "pm@ardaya.id", "procurement@ardaya.id",
    ]);
  });

  it("menerima beberapa email dalam satu argumen berkoma", () => {
    const args = parseArgs(["--email", "a@x.id,b@x.id", "--dry-run"]);
    expect(args.emails).toContain("a@x.id,b@x.id");
    expect(args.dryRun).toBe(true);
    expect(args.emails.flatMap((entry) => entry.split(","))).toHaveLength(2);
  });

  it("menolak password lemah sebelum menyentuh database", () => {
    expect(() => assertStrong("pendek", "--password")).toThrow(/minimal 12/);
    expect(() => assertStrong("tanpahurufbesar123", "--password")).toThrow(/huruf besar/);
    expect(() => assertStrong("TanpaAngkaSamaSekali", "--password")).toThrow(/angka/);
    expect(() => assertStrong("ArdayaDemo2026", "--password")).not.toThrow();
  });
});
