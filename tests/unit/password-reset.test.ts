import { afterEach, describe, expect, it } from "vitest";
import {
  RESET_REQUESTS_PER_HOUR, RESET_TTL_MINUTES, appBaseUrl, resetAvailability, resetTtlMinutes,
} from "@/modules/auth/password-reset";
import { emailDriver, invitationEmail, isEmailConfigured, passwordResetEmail } from "@/modules/notifications/email";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});
/* `NODE_ENV` bertipe readonly di @types/node; penulisan lewat helper ini tetap
 * memakai mekanisme yang sama dengan kode produksi (process.env). */
const setNodeEnv = (value: string) => { (process.env as Record<string, string | undefined>).NODE_ENV = value; };

describe("0011 · konfigurasi tautan reset", () => {
  it("APP_BASE_URL dipakai apa adanya tanpa garis miring ganda", () => {
    process.env.APP_BASE_URL = "https://epc.contoh.co.id/";
    expect(appBaseUrl()).toBe("https://epc.contoh.co.id");
    expect(resetAvailability().configured).toBe(true);
  });

  it("jatuh ke URL preview Vercel, lalu localhost di development", () => {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "epc-project.vercel.app";
    expect(appBaseUrl()).toBe("https://epc-project.vercel.app");
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    setNodeEnv("development");
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });

  it("production tanpa APP_BASE_URL melaporkan belum siap (bukan menebak)", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    setNodeEnv("production");
    expect(appBaseUrl()).toBeNull();
    expect(resetAvailability().configured).toBe(false);
  });

  it("TTL default 30 menit dan menolak nilai tidak wajar", () => {
    delete process.env.PASSWORD_RESET_TTL_MINUTES;
    expect(resetTtlMinutes()).toBe(RESET_TTL_MINUTES);
    process.env.PASSWORD_RESET_TTL_MINUTES = "1";
    expect(resetTtlMinutes()).toBe(RESET_TTL_MINUTES); // terlalu pendek
    process.env.PASSWORD_RESET_TTL_MINUTES = "999";
    expect(resetTtlMinutes()).toBe(RESET_TTL_MINUTES); // terlalu panjang
    process.env.PASSWORD_RESET_TTL_MINUTES = "45";
    expect(resetTtlMinutes()).toBe(45);
  });

  it("batas 3 permintaan per akun per jam tetap terjaga", () => {
    expect(RESET_REQUESTS_PER_HOUR).toBe(3);
  });
});

describe("0011 · driver email", () => {
  it("default: console di development, none di production", () => {
    delete process.env.EMAIL_DRIVER;
    setNodeEnv("development");
    expect(emailDriver()).toBe("console");
    expect(isEmailConfigured()).toBe(true);
    setNodeEnv("production");
    expect(emailDriver()).toBe("none");
    expect(isEmailConfigured()).toBe(false);
  });

  it("resend tanpa API key dianggap belum siap", () => {
    process.env.EMAIL_DRIVER = "resend";
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_dummy";
    expect(isEmailConfigured()).toBe(true);
  });

  it("nilai driver tak dikenal tidak pernah diam-diam menjadi resend", () => {
    process.env.EMAIL_DRIVER = "smtp";
    setNodeEnv("development");
    expect(emailDriver()).toBe("console");
  });
});

describe("0011 · isi email", () => {
  it("email reset memuat tautan, masa berlaku, dan peringatan bila tidak diminta", () => {
    const link = "https://epc.contoh.co.id/reset-password?token=abc123";
    const message = passwordResetEmail({ name: "Nadia", link, expiresMinutes: 30 });
    expect(message.subject).toMatch(/password/i);
    expect(message.text).toContain(link);
    expect(message.text).toContain("30 menit");
    expect(message.text).toMatch(/tidak meminta/i);
    expect(message.html).toContain("Atur password baru");
  });

  it("HTML email meng-escape nama agar tidak menjadi vektor injeksi", () => {
    const message = passwordResetEmail({ name: "<script>alert(1)</script>", link: "https://x/y", expiresMinutes: 30 });
    expect(message.html).not.toContain("<script>alert(1)</script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("email undangan menyebut company, peran, dan masa berlaku", () => {
    const message = invitationEmail({ companyName: "PT Ardaya <Energi>", roleLabel: "Project Manager", link: "https://x/accept", expiresHours: 72 });
    expect(message.text).toContain("PT Ardaya <Energi>");
    expect(message.text).toContain("Project Manager");
    expect(message.text).toContain("72 jam");
    expect(message.html).not.toContain("PT Ardaya <Energi>"); // di-escape
  });
});
