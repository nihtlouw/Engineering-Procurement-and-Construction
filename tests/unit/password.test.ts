import { describe, expect, it } from "vitest";
import { adminResetPasswordSchema, changePasswordSchema } from "@/modules/companies/validation";
import { hashPasswordForStorage, verifyPasswordHash } from "../../scripts/hash-password";

/**
 * Aturan password untuk jalur pemulihan. Dua jalur berbeda sengaja punya
 * konsekuensi berbeda:
 * - reset oleh ADMIN (tanpa password lama) → minimal 12 karakter + campuran;
 * - ganti sendiri → wajib password lama, dan password baru tidak boleh sama.
 */
describe("reset password", () => {
  it("menerima password kuat", () => {
    expect(adminResetPasswordSchema.parse({ newPassword: "Ard4yaPondasi26" }).newPassword).toBe("Ard4yaPondasi26");
  });

  it("menolak password pendek, tanpa angka, atau tanpa huruf besar", () => {
    expect(() => adminResetPasswordSchema.parse({ newPassword: "Ard4ya" })).toThrow(/12 karakter/);
    expect(() => adminResetPasswordSchema.parse({ newPassword: "ArdayaPondasi" })).toThrow(/angka/);
    // "ardayaP0ndasi" LOLOS: sudah ada huruf besar, huruf kecil, dan angka.
    expect(adminResetPasswordSchema.parse({ newPassword: "ardayaP0ndasi" }).newPassword).toBe("ardayaP0ndasi");
    expect(() => adminResetPasswordSchema.parse({ newPassword: "ardaya0pondasi" })).toThrow(/huruf besar/);
    expect(() => adminResetPasswordSchema.parse({ newPassword: "ARDAYA2PONDASI" })).toThrow(/huruf kecil/);
  });

  it("menolak password yang terlalu panjang (mencegah DoS scrypt)", () => {
    expect(() => adminResetPasswordSchema.parse({ newPassword: `${"Aa1".repeat(60)}` })).toThrow(/128/);
  });
});

describe("ganti password sendiri", () => {
  it("wajib menyertakan password lama", () => {
    expect(() => changePasswordSchema.parse({ newPassword: "Ard4yaPondasi26" })).toThrow();
  });

  it("menolak password baru yang sama dengan password lama", () => {
    expect(() => changePasswordSchema.parse({
      currentPassword: "Ard4yaPondasi26", newPassword: "Ard4yaPondasi26",
    })).toThrow(/berbeda/);
  });

  it("menerima kombinasi valid", () => {
    const parsed = changePasswordSchema.parse({ currentPassword: "Lama4Sekali2026", newPassword: "Baru5Sekali2026" });
    expect(parsed.newPassword).toBe("Baru5Sekali2026");
  });
});

/**
 * Alat bantu table editor: hash harus berformat PERSIS seperti `hashPassword()`
 * di src/lib/auth.ts (salt hex 16 byte + ":" + scrypt 64 byte hex), karena
 * `verifyPassword()` tidak mentoleransi format lain.
 */
describe("hash password untuk table editor", () => {
  it("menghasilkan format salt:hash yang dapat diverifikasi", () => {
    const hash = hashPasswordForStorage("Ard4yaPemulihan26");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(hash).toHaveLength(161);
    expect(verifyPasswordHash("Ard4yaPemulihan26", hash)).toBe(true);
  });

  it("password salah tidak lolos dan salt selalu berbeda", () => {
    const first = hashPasswordForStorage("Ard4yaPemulihan26");
    const second = hashPasswordForStorage("Ard4yaPemulihan26");
    expect(first).not.toBe(second); // salt acak → hash berbeda
    expect(verifyPasswordHash("ard4yapemulihan26", first)).toBe(false);
    expect(verifyPasswordHash("Ard4yaPemulihan27", first)).toBe(false);
  });

  it("menolak hash cacat (mis. password polos yang tidak sengaja ditempel)", () => {
    expect(verifyPasswordHash("Ard4yaPemulihan26", "Ard4yaPemulihan26")).toBe(false);
    expect(verifyPasswordHash("Ard4yaPemulihan26", "")).toBe(false);
  });
});
