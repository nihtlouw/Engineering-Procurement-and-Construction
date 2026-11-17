import { z } from "zod";
import { amount, positiveAmount } from "@/modules/budgeting/validation";

export const poItemInputSchema = z.object({
  budgetLineId: z.string().nullable().optional(),
  description: z.string().trim().min(3, "Uraian pos PO minimal 3 karakter."),
  quantity: positiveAmount("Volume PO"),
  unitCode: z.string().trim().min(1, "Satuan wajib diisi."),
  unitAmount: amount("Harga satuan PO"),
  sortOrder: z.number().int().min(0).optional(),
}).refine(
  (l) => l.budgetLineId == null || l.budgetLineId.length > 0,
  { message: "Pos RAB tidak valid.", path: ["budgetLineId"] },
);

export const createPoItemsSchema = z.array(poItemInputSchema).min(1, "Minimal satu pos PO.").max(200);

export const receivePoSchema = z.object({
  action: z.literal("RECEIVE"),
  items: z.array(z.object({
    itemId: z.string().min(1),
    receivedQty: amount("Qty diterima"),
  })).min(1, "Minimal satu pos diterima."),
});
export type ReceivePoInput = z.infer<typeof receivePoSchema>;

export const coItemSchema = z.object({
  projectId: z.string().min(1),
  variationType: z.enum(["ADD", "OMIT", "SUBSTITUTE"]).default("ADD"),
  title: z.string().trim().min(5),
  reason: z.string().trim().min(5),
  scopeDescription: z.string().trim().min(5),
  priceImpact: amount("Dampak harga", true),
  costImpact: amount("Dampak biaya", true),
  timeImpactDays: z.number().int().min(-3650).max(3650),
  clientReference: z.string().max(120).nullable().optional(),
  evidenceFileId: z.string().nullable().optional(),
}).refine(
  (v) => v.variationType !== "OMIT" || Number(v.priceImpact) <= 0,
  { message: "CO Kurang harus berdampak harga negatif atau nol.", path: ["priceImpact"] },
);
export type CoInput = z.infer<typeof coItemSchema>;

export const coActionSchema = z.object({
  action: z.enum(["SUBMIT", "SEND_CLIENT", "RETURN", "APPROVE", "REJECT", "CANCEL"]),
  reason: z.string().optional(),
});
