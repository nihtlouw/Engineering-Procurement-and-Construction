import { describe, expect, it } from "vitest";
import {
  assertSingleRetention, summarizeTermComposition, TERM_PERCENT_TOLERANCE, TERM_TYPES,
  type TermDraft,
} from "@/modules/master-data/types";
import {
  closeTermSchema, contractTermSchema, costCategorySchema, saveTermsSchema, unitSchema,
} from "@/modules/master-data/validation";

/* Tahap 3: aturan komposisi termin dan validasi katalog diuji tanpa database. */

const term = (patch: Partial<TermDraft> = {}): TermDraft => ({ type: "PROGRESS", percent: null, ...patch });

describe("termin kontrak · komposisi persen", () => {
  it("skema standar 30/20/40/10 berjumlah 100 tanpa peringatan", () => {
    const result = summarizeTermComposition([
      term({ type: "DP", percent: "30" }), term({ type: "MOS", percent: "20" }),
      term({ type: "PROGRESS", percent: "40" }), term({ type: "RETENTION", percent: "10" }),
    ]);
    expect(result.totalPercent).toBe(100);
    expect(result.warning).toBeNull();
    expect(result.usesAmountOnly).toBe(false);
  });

  it("toleransi 0.01 menyerap pembulatan desimal, 0.02 ditolak", () => {
    expect(TERM_PERCENT_TOLERANCE).toBe(0.01);
    expect(summarizeTermComposition([term({ percent: "33.33" }), term({ percent: "66.67" })]).warning).toBeNull();
    expect(summarizeTermComposition([term({ percent: "33.34" }), term({ percent: "66.67" })]).warning).toMatch(/100%/);
  });

  it("termin nominal manual murni tidak diwajibkan 100%", () => {
    const result = summarizeTermComposition([term({ percent: null }), term({ percent: null })]);
    expect(result.totalPercent).toBe(0);
    expect(result.warning).toBeNull();
    expect(result.usesAmountOnly).toBe(true);
  });

  it("campuran persen & nominal valid asal total persen 100", () => {
    const result = summarizeTermComposition([
      term({ type: "DP", percent: "50" }), term({ percent: "50" }), term({ percent: null }),
    ]);
    expect(result.warning).toBeNull();
    expect(result.usesAmountOnly).toBe(true);
  });
});

describe("termin kontrak · retensi tunggal", () => {
  it("maksimal satu termin RETENTION per proyek", () => {
    expect(assertSingleRetention([term({ type: "RETENTION" }), term()])).toBeNull();
    expect(assertSingleRetention([term({ type: "RETENTION" }), term({ type: "RETENTION" })])).toMatch(/RETENTION hanya boleh satu/);
  });
});

describe("termin kontrak · validasi input", () => {
  it("persen XOR nominal: keduanya kosong ditolak", () => {
    expect(() => contractTermSchema.parse({ type: "DP", name: "Uang muka" })).toThrow();
    expect(contractTermSchema.parse({ type: "DP", name: "Uang muka", percent: "30" }).percent).toBe("30");
    expect(contractTermSchema.parse({ type: "OTHER", name: "Sekaligus", amount: "1000" }).amount).toBe("1000");
  });

  it("menolak jenis termin di luar daftar dan persen > 100", () => {
    expect(() => contractTermSchema.parse({ type: "FAT", name: "Salah", percent: "10" })).toThrow();
    expect(() => contractTermSchema.parse({ type: "DP", name: "Terlalu besar", percent: "120" })).toThrow();
    expect([...TERM_TYPES]).toContain("RETENTION");
  });

  it("membatasi maksimal 40 termin per proyek dan alasan penutupan minimal 5 karakter", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ type: "PROGRESS", name: `Termin ${i}`, percent: "1" }));
    expect(() => saveTermsSchema.parse({ terms: many })).toThrow();
    expect(() => closeTermSchema.parse({ action: "CLOSE", reason: "ok" })).toThrow();
    expect(closeTermSchema.parse({ action: "CLOSE", reason: "tidak ditagih" }).action).toBe("CLOSE");
  });
});

describe("katalog biaya · validasi", () => {
  it("kode kategori diuppercase dan dibatasi 24 karakter", () => {
    expect(costCategorySchema.parse({ code: "mat", name: "Material" }).code).toBe("MAT");
    expect(() => costCategorySchema.parse({ code: "A", name: "Material" })).toThrow();
    // 25 karakter > batas 24.
    expect(() => costCategorySchema.parse({ code: "PEMELIHARAAN-PERALATAN-XX", name: "Material" })).toThrow();
    expect(() => costCategorySchema.parse({ code: "MA T", name: "Material" })).toThrow();
  });

  it("kode satuan diawali huruf dan peka huruf (m2, Ls)", () => {
    expect(unitSchema.parse({ code: "m2", name: "Meter persegi" }).code).toBe("m2");
    expect(unitSchema.parse({ code: "Ls", name: "Lump sum" }).code).toBe("Ls");
    expect(() => unitSchema.parse({ code: "2m", name: "Salah" })).toThrow();
    expect(() => unitSchema.parse({ code: "m".repeat(13), name: "Panjang" })).toThrow();
  });
});
