import { describe, expect, it } from "vitest";
import { adminResetPasswordSchema, changePasswordSchema } from "@/modules/companies/validation";

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
