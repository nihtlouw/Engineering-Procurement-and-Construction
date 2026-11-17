import { describe, expect, it } from "vitest";
import { evaluateTermLimit } from "@/modules/procurement/service";
import { PO_TRANSITIONS, TERM_STATUSES } from "@/modules/procurement/types";
import {
  coActionSchema, coItemSchema, createPoItemsSchema, poItemInputSchema, receivePoSchema,
} from "@/modules/procurement/validation";

describe("S2b · pagu termin & kontrak", () => {
  it("mendeteksi over-invoice termin dan memblokir tanpa alasan + izin", () => {
    const result = evaluateTermLimit({
      termAmount: "100.00", termUsed: "60.00", incoming: "50.00",
      contractValue: "1100.00", projectUsed: "60.00", reason: "", canApprove: false,
    });
    expect(result).toMatchObject({
      termAfter: "110.00", projectAfter: "110.00",
      overTerm: true, overContract: false, blocked: true,
    });
  });

  it("mendeteksi pagu nilai kontrak terlampaui", () => {
    const result = evaluateTermLimit({
      termAmount: "100.00", termUsed: "0.00", incoming: "1200.00",
      contractValue: "1100.00", projectUsed: "0.00", reason: "Disetujui direksi", canApprove: false,
    });
    expect(result.overTerm).toBe(true);
    expect(result.overContract).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it("over-invoice hanya lolos dengan alasan >=5 karakter DAN invoice.approve", () => {
    const base = {
      termAmount: "100.00", termUsed: "60.00", incoming: "50.00",
      contractValue: "1100.00", projectUsed: "60.00",
    };
    expect(evaluateTermLimit({ ...base, reason: "ok", canApprove: true }).blocked).toBe(true);
    expect(evaluateTermLimit({ ...base, reason: "Disetujui direksi", canApprove: false }).blocked).toBe(true);
    expect(evaluateTermLimit({ ...base, reason: "Disetujui direksi", canApprove: true }).blocked).toBe(false);
  });

  it("invoice tanpa termin tetap memakai pagu kontrak", () => {
    const result = evaluateTermLimit({
      termAmount: "1100.00", termUsed: "0.00", incoming: "1200.00",
      contractValue: "1100.00", projectUsed: "0.00", canApprove: false,
    });
    expect(result.overContract).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it("status termin & transisi PO sesuai kontrak modul", () => {
    expect(TERM_STATUSES).toEqual(["OPEN", "PARTIALLY_INVOICED", "INVOICED", "CLOSED"]);
    expect(PO_TRANSITIONS.RECEIVED).toEqual(["CLOSED"]);
    expect(PO_TRANSITIONS.ORDERED).toContain("PARTIALLY_RECEIVED");
  });
});

describe("S2b · validasi DTO", () => {
  const validItem = { description: "Pipa HDPE", quantity: "2", unitCode: "m", unitAmount: "100.00" };

  it("pos PO wajib volume positif dan harga satuan non-negatif", () => {
    expect(poItemInputSchema.safeParse(validItem).success).toBe(true);
    expect(poItemInputSchema.safeParse({ ...validItem, unitAmount: "-1" }).success).toBe(false);
    expect(poItemInputSchema.safeParse({ ...validItem, quantity: "0" }).success).toBe(false);
    expect(createPoItemsSchema.safeParse([]).success).toBe(false);
  });

  it("penerimaan per pos menerima qty desimal dan menolak payload kosong", () => {
    expect(receivePoSchema.safeParse({ action: "RECEIVE", items: [{ itemId: "i1", receivedQty: "1.5" }] }).success).toBe(true);
    expect(receivePoSchema.safeParse({ action: "RECEIVE", items: [] }).success).toBe(false);
  });

  it("CO Kurang wajib dampak harga <= 0 dan dampak waktu boleh negatif", () => {
    const base = {
      projectId: "p1", title: "Kurangi panel", reason: "Permintaan klien",
      scopeDescription: "Mengurangi satu panel", costImpact: "0", timeImpactDays: -3,
    };
    expect(coItemSchema.safeParse({ ...base, variationType: "OMIT", priceImpact: "10" }).success).toBe(false);
    expect(coItemSchema.safeParse({ ...base, variationType: "OMIT", priceImpact: "-10" }).success).toBe(true);
    expect(coActionSchema.safeParse({ action: "CANCEL", reason: "Dibatalkan klien" }).success).toBe(true);
  });
});
