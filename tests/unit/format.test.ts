import { describe, expect, it } from "vitest";
import { D, money, parseIndonesianNumber, terbilang, todayJakarta } from "@/lib/format";

describe("uang & angka", () => {
  it("Decimal dipakai untuk menghindari error floating point", () => {
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(money("1234.567")).toBe("1234.57");
  });

  it("memparsing format rupiah Indonesia", () => {
    expect(parseIndonesianNumber("Rp 1.250.000")).toBe("1250000.00");
    expect(parseIndonesianNumber("1.250.000,50")).toBe("1250000.50");
    expect(parseIndonesianNumber("tidak ada angka")).toBeNull();
  });

  it("terbilang tidak menghasilkan spasi ganda", () => {
    expect(terbilang("1000000")).toBe("Satu juta rupiah");
    expect(terbilang("0")).toBe("Nol rupiah");
  });

  it("tanggal hari ini memakai timezone Jakarta", () => {
    expect(todayJakarta()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
