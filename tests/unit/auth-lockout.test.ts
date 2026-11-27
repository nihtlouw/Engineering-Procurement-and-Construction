import { describe, expect, it } from "vitest";
import { lockMinutesFor } from "@/app/api/auth/login/route";

/**
 * 0010: ambang kunci akun. Fungsi murni ini menentukan berapa lama akun
 * dikunci setelah N kegagalan; nilainya harus monoton dan berhenti di 0
 * selama ambang belum tercapai (supaya kesalahan ketik wajar tidak mengunci).
 */
describe("0010 · ambang kunci login", () => {
  it("tidak mengunci di bawah 10 kegagalan", () => {
    expect(lockMinutesFor(0)).toBe(0);
    expect(lockMinutesFor(1)).toBe(0);
    expect(lockMinutesFor(9)).toBe(0);
  });

  it("mengunci 15 menit mulai 10 kegagalan, 60 menit mulai 20", () => {
    expect(lockMinutesFor(10)).toBe(15);
    expect(lockMinutesFor(15)).toBe(15);
    expect(lockMinutesFor(20)).toBe(60);
    expect(lockMinutesFor(99)).toBe(60);
  });

  it("durasi tidak pernah menurun saat kegagalan bertambah", () => {
    let previous = 0;
    for (let failures = 0; failures <= 40; failures += 1) {
      const minutes = lockMinutesFor(failures);
      expect(minutes).toBeGreaterThanOrEqual(previous);
      previous = minutes;
    }
  });
});
