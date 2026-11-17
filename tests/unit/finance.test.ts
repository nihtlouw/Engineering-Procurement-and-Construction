import { describe, expect, it } from "vitest";
import { buildCloseCheck, calculateProjectMetrics, displayInvoiceStatus, invoiceBalance } from "@/lib/finance";

const project = { id: "p1", contractValue: "1000000000", contractValueCurrent: "1000000000", retentionPct: "5", bast1Date: null, bast2Date: null };
const base = {
  project, expenses: [], purchases: [], invoices: [], budgets: [],
  schedule: [], canViewInternal: true,
};

describe("saldo & status invoice", () => {
  it("menghitung saldo setelah pembayaran + potongan PPh", () => {
    const invoice = {
      id: "i1", projectId: "p1", type: "PROGRESS", status: "SENT", totalAmount: "111000000",
      dueDate: "2099-01-01", payments: [{ cashReceivedAmount: "80000000", withholdingTaxAmount: "11000000" }],
    };
    expect(invoiceBalance(invoice).toString()).toBe("20000000");
    // Sudah ada pembayaran sebagian dan belum jatuh tempo -> PARTIALLY_PAID.
    expect(displayInvoiceStatus(invoice)).toBe("PARTIALLY_PAID");
  });

  it("menandai OVERDUE bila masih ada saldo dan lewat jatuh tempo", () => {
    const invoice = {
      id: "i2", projectId: "p1", type: "PROGRESS", status: "SENT", totalAmount: "111000000",
      dueDate: "2020-01-01", payments: [],
    };
    expect(displayInvoiceStatus(invoice)).toBe("OVERDUE");
  });
});

describe("metrik proyek", () => {
  it("progres terbobot dihitung dari bobot WBS", () => {
    const result = calculateProjectMetrics({
      ...base,
      schedule: [
        { projectId: "p1", weight: "25", progressPct: "100" },
        { projectId: "p1", weight: "75", progressPct: "0" },
      ],
    });
    expect(result.progressPct).toBe(25);
  });

  it("mengabaikan item jadwal proyek lain", () => {
    const result = calculateProjectMetrics({
      ...base,
      schedule: [
        { projectId: "p1", weight: "100", progressPct: "40" },
        { projectId: "p2", weight: "100", progressPct: "100" },
      ],
    });
    expect(result.progressPct).toBe(40);
  });

  it("S2a: nilai kontrak berjalan dibaca dari SATU kolom, bukan dijumlah ulang dari CO", () => {
    const result = calculateProjectMetrics({
      ...base,
      project: { ...project, contractValue: "1000000000", contractValueCurrent: "1100000000" },
    });
    expect(result.contractValueCurrent).toBe("1100000000.00");
    // Retensi 5% ikut nilai kontrak berjalan (bukan kontrak awal).
    expect(result.retentionOutstanding).toBe("55000000.00");
  });

  it("biaya aktual hanya dari expense APPROVED pada proyek ini", () => {
    const result = calculateProjectMetrics({
      ...base,
      expenses: [
        { id: "e1", approvalStatus: "APPROVED", purchaseRecordId: null, defaultProjectId: "p1", paidByType: "COMPANY", totalAmount: "100", lines: [{ projectId: "p1", scope: "PROJECT", lineTotal: "100" }] },
        { id: "e2", approvalStatus: "SUBMITTED", purchaseRecordId: null, defaultProjectId: "p1", paidByType: "COMPANY", totalAmount: "900", lines: [{ projectId: "p1", scope: "PROJECT", lineTotal: "900" }] },
      ],
    });
    expect(result.actualCost).toBe("100.00");
    expect(result.pendingCost).toBe("900.00");
  });
});

describe("close check", () => {
  it("mendeteksi punch list terbuka dan dokumen wajib belum lengkap", () => {
    const checks = buildCloseCheck({
      projectId: "p1", invoices: [], expenses: [],
      punchItems: [{ projectId: "p1", isClosed: false }],
      handoverItems: [{ projectId: "p1", isRequired: true, isDone: false, name: "BAST 1" }],
    });
    expect(checks.find((c) => c.key === "punch")?.ok).toBe(false);
    expect(checks.find((c) => c.key === "documents")?.ok).toBe(false);
  });
});
