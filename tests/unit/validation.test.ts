import { describe, expect, it } from "vitest";
import { acceptInviteSchema, inviteSchema, switchCompanySchema, updateMemberSchema } from "@/modules/companies/validation";

describe("validasi undangan", () => {
  it("menormalkan email ke huruf kecil dan menerima role valid", () => {
    const parsed = inviteSchema.parse({ email: "Budi@Perusahaan.CO.ID", companyRole: "FIELD" });
    expect(parsed.email).toBe("budi@perusahaan.co.id");
  });

  it("menolak email tidak valid dan role di luar daftar", () => {
    expect(inviteSchema.safeParse({ email: "bukan-email", companyRole: "FIELD" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "budi@pt.id", companyRole: "SUPERADMIN" }).success).toBe(false);
  });

  it("menolak token pendek dan password lemah", () => {
    expect(acceptInviteSchema.safeParse({ token: "pendek", name: "Budi", password: "ArdayaKuat2026" }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token: "x".repeat(64), name: "Budi", password: "123" }).success).toBe(false);
    // Perubahan: undangan kini memakai aturan password yang SAMA dengan reset &
    // ganti password (12 karakter + campuran). Sebelumnya 8 karakter tanpa
    // campuran, sehingga pengguna baru bisa masuk dengan "rahasia123".
    expect(acceptInviteSchema.safeParse({ token: "x".repeat(64), name: "Budi", password: "rahasia123" }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token: "x".repeat(64), name: "Budi", password: "ArdayaKuat2026" }).success).toBe(true);
  });

  it("menerima CLIENT_VIEWER sebagai role undangan", () => {
    expect(inviteSchema.safeParse({ email: "klien@pt.id", companyRole: "CLIENT_VIEWER" }).success).toBe(true);
  });
});

describe("validasi manajemen anggota", () => {
  it("menolak payload kosong", () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
  });
  it("menerima perubahan peran atau status", () => {
    expect(updateMemberSchema.safeParse({ companyRole: "PM" }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ status: "SUSPENDED" }).success).toBe(true);
  });
  it("menolak status di luar enum", () => {
    expect(updateMemberSchema.safeParse({ status: "DELETED" }).success).toBe(false);
  });
});

describe("validasi perpindahan company", () => {
  it("hanya menerima UUID", () => {
    expect(switchCompanySchema.safeParse({ companyId: "bukan-uuid" }).success).toBe(false);
    expect(switchCompanySchema.safeParse({ companyId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });
});
