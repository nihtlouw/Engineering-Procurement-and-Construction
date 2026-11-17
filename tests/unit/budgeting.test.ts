import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/lib/domain";
import { evaluatePagu, lineTotal, paguAmount } from "@/modules/budgeting/pagu";
import { BUDGET_TRANSITIONS, VARIATION_TRANSITIONS } from "@/modules/budgeting/types";
import { createBudgetSchema, createVariationSchema, variationActionSchema } from "@/modules/budgeting/validation";

describe("perhitungan RAB & pagu (Decimal, bukan float)", () => {
  it("total pos = volume × harga satuan, presisi 2 desimal", () => {
    expect(lineTotal("0.1", "3")).toBe("0.30");
    expect(lineTotal("3.3333", "125000.50")).toBe("416664.17");
  });

  it("pagu memakai contingencyPct yang sebelumnya tidak terpakai (B3)", () => {
    expect(paguAmount("1000.00", "10")).toBe("1100.00");
    expect(paguAmount("1000.00", null)).toBe("1000.00");
  });

  it("90% warning, 100% masih oke, 110% diblokir", () => {
    // Spesifikasi UI: "berubah warna DI ATAS 90%", jadi tepat 90% masih normal.
    expect(evaluatePagu({ total: "1000", actual: "900" }).tone).toBe("ok");
    expect(evaluatePagu({ total: "1000", actual: "901" }).tone).toBe("warn");
    expect(evaluatePagu({ total: "1000", actual: "1000" }).blocked).toBe(false);
    const over = evaluatePagu({ total: "1000", actual: "800", pending: "100", committed: "100", incoming: "100" });
    expect(over.blocked).toBe(true);
    expect(over.ratioPct).toBe(110);
    expect(over.used).toBe("1100.00");
  });

  it("kontingensi menaikkan pagu sehingga 105% nilai pos tidak serta-merta overbudget", () => {
    const ev = evaluatePagu({ total: "1000", contingencyPct: "10", actual: "1050" });
    expect(ev.pagu).toBe("1100.00");
    expect(ev.blocked).toBe(false);
    expect(ev.tone).toBe("warn");
  });
});

describe("workflow RAB & PTK", () => {
  it("baseline terkunci: tidak ada transisi keluar dari BASELINE", () => {
    expect(BUDGET_TRANSITIONS.BASELINE).toEqual({});
    expect(BUDGET_TRANSITIONS.APPROVED?.SET_BASELINE).toBe("BASELINE");
  });

  it("PTK bisa dibatalkan sampai status APPROVED, dan IMPLEMENTED final", () => {
    expect(VARIATION_TRANSITIONS.APPROVED?.CANCEL).toBe("CANCELLED");
    expect(VARIATION_TRANSITIONS.APPROVED?.IMPLEMENT).toBe("IMPLEMENTED");
    expect(VARIATION_TRANSITIONS.IMPLEMENTED).toEqual({});
  });

  it("RAB internal hanya ADMIN / PM / FINANCE (keputusan #7)", () => {
    const allowed = (Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[])
      .filter((role) => ROLE_PERMISSIONS[role].includes("budget.internal.view"));
    expect(allowed.sort()).toEqual(["ADMIN", "FINANCE", "PM"]);
  });
});

describe("validasi Zod S2a", () => {
  const validLine = {
    action: "ADD", budgetType: "CLIENT", description: "Tambah panel LVMDP",
    quantity: "2", unitCode: "set", unitAmount: "10000000", priceAmount: "22000000", costAmount: "20000000",
  };

  it("menolak volume nol dan menerima volume sah", () => {
    const line = { costCategoryId: "cat-civ", description: "Pekerjaan sipil", quantity: "0", unitCode: "Ls", unitAmount: "100" };
    expect(createBudgetSchema.safeParse({ projectId: "p1", type: "CLIENT", lines: [line] }).success).toBe(false);
    expect(createBudgetSchema.safeParse({ projectId: "p1", type: "CLIENT", lines: [{ ...line, quantity: "2.5" }] }).success).toBe(true);
  });

  it("dampak PTK harus sama dengan jumlah baris", () => {
    const payload = {
      projectId: "p1", variationType: "ADD", title: "Tambah pekerjaan", reason: "Permintaan klien",
      scopeDescription: "Tambah satu panel", priceImpact: "1", costImpact: "0", timeImpactDays: 3,
      lines: [validLine],
    };
    const result = createVariationSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toContain("priceImpact");
  });

  it("menerima dampak NEGATIF untuk pekerjaan kurang (PTK OMIT)", () => {
    const payload = {
      projectId: "p1", variationType: "OMIT", title: "Kurangi pekerjaan", reason: "Lingkup dicoret klien",
      scopeDescription: "Satu panel dibatalkan", priceImpact: "-22000000", costImpact: "-20000000",
      timeImpactDays: -5,
      lines: [{ ...validLine, action: "OMIT", budgetLineId: "bl-1", priceAmount: "-22000000", costAmount: "-20000000" }],
    };
    expect(createVariationSchema.safeParse(payload).success).toBe(true);
  });

  it("menolak PTK Tambah berdampak negatif", () => {
    const payload = {
      projectId: "p1", variationType: "ADD", title: "Tambah pekerjaan", reason: "Permintaan klien",
      scopeDescription: "Tambah satu panel", priceImpact: "-1", costImpact: "0", timeImpactDays: 0,
      lines: [{ ...validLine, priceAmount: "-1", costAmount: "0" }],
    };
    expect(createVariationSchema.safeParse(payload).success).toBe(false);
  });

  it("OMIT/ADJUST wajib memilih pos RAB existing", () => {
    const payload = {
      projectId: "p1", variationType: "OMIT", title: "Kurangi pekerjaan", reason: "Lingkup dicoret klien",
      scopeDescription: "Satu panel dibatalkan", priceImpact: "-1", costImpact: "-1", timeImpactDays: 0,
      lines: [{ ...validLine, action: "OMIT", priceAmount: "-1", costAmount: "-1" }],
    };
    expect(createVariationSchema.safeParse(payload).success).toBe(false);
  });

  it("aksi IMPLEMENT valid, aksi asing ditolak", () => {
    expect(variationActionSchema.safeParse({ action: "IMPLEMENT" }).success).toBe(true);
    expect(variationActionSchema.safeParse({ action: "HAPUS" }).success).toBe(false);
  });
});
