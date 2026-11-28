import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SCRYPT_PARAMS,
  hashPasswordAsync,
  hashPasswordSync,
  needsRehash,
  parseStoredHash,
  verifyPasswordAsync,
  verifyPasswordSync,
} from "@/lib/passwords";

/** Hash legacy persis seperti 6 akun demo di database produksi. */
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

describe("format hash password", () => {
  it("hash baru memakai format berversi dan parameter aktif", () => {
    const hash = hashPasswordSync("ArdayaAdmin2026");
    expect(hash.startsWith("scrypt$N=32768,r=8,p=1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(4);
    expect(hash).toHaveLength(184);
  });

  it("setiap hash unik (salt acak), tetapi keduanya memverifikasi password yang sama", async () => {
    const first = await hashPasswordAsync("ArdayaAdmin2026");
    const second = await hashPasswordAsync("ArdayaAdmin2026");
    expect(first).not.toBe(second);
    expect(await verifyPasswordAsync("ArdayaAdmin2026", first)).toBe(true);
    expect(await verifyPasswordAsync("ArdayaAdmin2026", second)).toBe(true);
  });

  it("menolak password yang salah, kosong, dan hash yang rusak", async () => {
    const hash = await hashPasswordAsync("ArdayaAdmin2026");
    expect(await verifyPasswordAsync("ArdayaAdmin2025", hash)).toBe(false);
    expect(await verifyPasswordAsync("", hash)).toBe(false);
    expect(await verifyPasswordAsync("ArdayaAdmin2026", "bukan-hash")).toBe(false);
    expect(await verifyPasswordAsync("ArdayaAdmin2026", "")).toBe(false);
    expect(await verifyPasswordAsync("ArdayaAdmin2026", "salt:pendek")).toBe(false);
  });

  it("menolak parameter berbahaya dari database yang dirusak (DoS scrypt)", async () => {
    // N=2^30 akan menghabiskan CPU; harus ditolak sebagai hash tidak valid.
    expect(parseStoredHash("scrypt$N=1073741824,r=8,p=1$aa$bb")).toBeNull();
    expect(parseStoredHash("scrypt$N=8,r=8,p=1$aa$bb")).toBeNull();
    expect(await verifyPasswordAsync("x", "scrypt$N=1073741824,r=8,p=1$aa$bb")).toBe(false);
  });
});

describe("kompatibilitas hash lama (jangan mengunci pengguna yang ada)", () => {
  it("hash legacy 161 karakter tetap bisa diverifikasi", async () => {
    const legacy = legacyHash("ArdayaDemo2026");
    expect(legacy).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPasswordAsync("ArdayaDemo2026", legacy)).toBe(true);
    expect(verifyPasswordSync("ArdayaDemo2026", legacy)).toBe(true);
    expect(await verifyPasswordAsync("salah", legacy)).toBe(false);
  });

  it("hash legacy ditandai perlu rehash, hash baru tidak", async () => {
    expect(needsRehash(legacyHash("ArdayaDemo2026"))).toBe(true);
    expect(needsRehash(await hashPasswordAsync("ArdayaDemo2026"))).toBe(false);
    expect(needsRehash("rusak")).toBe(true);
  });

  it("hash dengan parameter lebih lemah dari parameter aktif juga di-rehash", async () => {
    const weak = `scrypt$N=16384,r=8,p=1$${"ab".repeat(16)}$${"cd".repeat(64)}`;
    expect(needsRehash(weak)).toBe(true);
    expect(SCRYPT_PARAMS.N).toBeGreaterThan(16384);
  });
});

/**
 * Regresi yang paling mudah kambuh: seseorang menambahkan `scryptSync` lagi di
 * jalur request. Terukur bahwa 8 verifikasi paralel memblokir event loop
 * sepenuhnya (0 tick timer 10 ms selama 325 ms), sehingga satu penyerang dapat
 * memperlambat seluruh instance tanpa satu pun password benar.
 */
describe("larangan hashing sinkron di jalur request", () => {
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? filesUnder(full) : [full];
    });
  }

  it("tidak ada scryptSync di src/app atau src/modules", () => {
    const offenders = [...filesUnder("src/app"), ...filesUnder("src/modules")]
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("scryptSync"));
    expect(offenders).toEqual([]);
  });

  it("src/lib/auth.ts mendelegasikan ke modul password (bukan implementasi sendiri)", () => {
    // Kode saja, tanpa komentar: komentar justru menjelaskan MENGAPA scryptSync
    // dihindari, jadi menyebutnya di sana sah.
    const source = readFileSync("src/lib/auth.ts", "utf8");
    const code = source
      // Buang komentar blok (termasuk yang satu baris `/* ... */`) lalu komentar `//`.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).toContain("@/lib/passwords");
    expect(code).not.toContain("scryptSync");
  });
});
