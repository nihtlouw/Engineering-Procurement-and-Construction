import Decimal from "decimal.js";
import { z } from "zod";
import { BUDGET_TYPES, VARIATION_LINE_ACTIONS, VARIATION_TYPES } from "@/modules/budgeting/types";

/** String numerik, bukan number JS: seluruh uang memakai Decimal (audit §10.1). */
const amount = (label: string, signed = false) =>
  z.string().trim().refine(
    (v) => {
      if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return false;
      const d = new Decimal(v);
      return signed ? d.isFinite() : d.isFinite() && d.gte(0);
    },
    { message: `${label} harus angka${signed ? " (boleh negatif)" : " minimal 0"} dengan maksimal 2 desimal.` },
  );

const positiveAmount = (label: string) =>
  amount(label).refine((v) => new Decimal(v).gt(0), { message: `${label} harus lebih dari 0.` });

export const budgetLineSchema = z.object({
  code: z.string().max(40).nullable().optional(),
  costCategoryId: z.string().min(1, "Kategori wajib dipilih."),
  description: z.string().trim().min(3, "Uraian pos minimal 3 karakter."),
  quantity: positiveAmount("Volume"),
  unitCode: z.string().trim().min(1, "Satuan wajib diisi."),
  unitAmount: amount("Harga satuan"),
  contingencyPct: z.string().nullable().optional().refine(
    (v) => v == null || (/^\d+(\.\d{1,2})?$/.test(v) && new Decimal(v).lte(100)),
    { message: "Kontingensi 0–100%." },
  ),
  wbsItemId: z.string().nullable().optional(),
  keywords: z.string().max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const createBudgetSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(BUDGET_TYPES),
  revisionNote: z.string().max(300).nullable().optional(),
  lines: z.array(budgetLineSchema).min(1, "Minimal satu pos RAB.").max(300),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  revisionNote: z.string().trim().min(5, "Catatan revisi minimal 5 karakter."),
  lines: z.array(budgetLineSchema).min(1).max(300),
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const budgetActionSchema = z.object({
  action: z.enum(["SUBMIT", "APPROVE", "RETURN", "REJECT", "SET_BASELINE"]),
  reason: z.string().nullable().optional(),
});
export type BudgetActionInput = z.infer<typeof budgetActionSchema>;

export const variationLineSchema = z.object({
  action: z.enum(VARIATION_LINE_ACTIONS),
  budgetType: z.enum(BUDGET_TYPES),
  budgetLineId: z.string().nullable().optional(),
  description: z.string().trim().min(3, "Uraian pos PTK minimal 3 karakter."),
  quantity: positiveAmount("Volume"),
  unitCode: z.string().trim().min(1),
  unitAmount: amount("Harga satuan", true),
  priceAmount: amount("Dampak harga", true),
  costAmount: amount("Dampak biaya", true),
  sortOrder: z.number().int().min(0).optional(),
}).refine((l) => l.action === "ADD" || !!l.budgetLineId, {
  message: "Pos OMIT/ADJUST wajib memilih pos RAB yang diubah.", path: ["budgetLineId"],
});

const sum = (rows: { priceAmount: string; costAmount: string }[], key: "priceAmount" | "costAmount") =>
  rows.reduce((acc, r) => acc.plus(r[key]), new Decimal(0));

export const createVariationSchema = z.object({
  projectId: z.string().min(1),
  variationType: z.enum(VARIATION_TYPES),
  title: z.string().trim().min(5, "Judul minimal 5 karakter."),
  reason: z.string().trim().min(5, "Alasan minimal 5 karakter."),
  scopeDescription: z.string().trim().min(5, "Lingkup minimal 5 karakter."),
  priceImpact: amount("Dampak harga", true),
  costImpact: amount("Dampak biaya", true),
  timeImpactDays: z.number().int().min(-3650).max(3650),
  clientReference: z.string().max(120).nullable().optional(),
  evidenceFileId: z.string().nullable().optional(),
  lines: z.array(variationLineSchema).min(1, "Minimal satu pos PTK.").max(200),
}).superRefine((v, ctx) => {
  const p = sum(v.lines, "priceAmount");
  const c = sum(v.lines, "costAmount");
  if (!p.eq(v.priceImpact)) ctx.addIssue({ code: "custom", path: ["priceImpact"], message: `Dampak harga harus sama dengan jumlah pos (${p.toFixed(2)}).` });
  if (!c.eq(v.costImpact)) ctx.addIssue({ code: "custom", path: ["costImpact"], message: `Dampak biaya harus sama dengan jumlah pos (${c.toFixed(2)}).` });
  if (v.variationType === "ADD" && (p.lt(0) || c.lt(0))) ctx.addIssue({ code: "custom", message: "PTK Tambah tidak boleh berdampak negatif.", path: ["variationType"] });
  if (v.variationType === "OMIT" && (p.gt(0) || c.gt(0))) ctx.addIssue({ code: "custom", message: "PTK Kurang harus berdampak negatif atau nol.", path: ["variationType"] });
});
export type CreateVariationInput = z.infer<typeof createVariationSchema>;

export const variationActionSchema = z.object({
  action: z.enum(["SUBMIT", "SEND_CLIENT", "APPROVE", "REJECT", "CANCEL", "IMPLEMENT"]),
  reason: z.string().nullable().optional(),
  clientReference: z.string().max(120).nullable().optional(),
});
export type VariationActionInput = z.infer<typeof variationActionSchema>;

export { amount, positiveAmount };
