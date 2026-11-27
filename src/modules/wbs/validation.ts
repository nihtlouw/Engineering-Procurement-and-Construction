import { z } from "zod";
import { WBS_ITEM_TYPES, WBS_LEVELS, WBS_MAX_ITEMS } from "@/modules/wbs/types";

const isoDate = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: `${label} harus format YYYY-MM-DD.` });

const weight = z.string().trim().refine((value) => /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100, {
  message: "Bobot 0–100 dengan maksimal 2 desimal.",
});

const percent = z.string().trim().refine((value) => /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100, {
  message: "Progres 0–100 dengan maksimal 2 desimal.",
});

export const wbsItemSchema = z.object({
  /** ID baris lama; kosong = item WBS baru. */
  id: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  type: z.enum(WBS_ITEM_TYPES).default("ACTIVITY"),
  name: z.string().trim().min(3, "Nama item minimal 3 karakter.").max(160),
  code: z.string().trim().max(24).nullable().optional(),
  level: z.number().int().min(1).max(4).default(1),
  weight,
  progressPct: percent.default("0"),
  plannedStart: isoDate("Tanggal mulai").nullable().optional(),
  plannedEnd: isoDate("Tanggal selesai").nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  isSummary: z.boolean().default(false),
  notes: z.string().trim().max(300).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.plannedStart && value.plannedEnd && value.plannedEnd < value.plannedStart) {
    ctx.addIssue({ code: "custom", path: ["plannedEnd"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai." });
  }
  if (value.isSummary && Number(value.weight) > 0) {
    ctx.addIssue({ code: "custom", path: ["weight"], message: "Item ringkasan mengambil bobot dari anak-anaknya; isi bobot 0." });
  }
  if (!value.isSummary && !value.level) {
    ctx.addIssue({ code: "custom", path: ["level"], message: "Level wajib 1–4." });
  }
});

export type WbsItemInput = z.infer<typeof wbsItemSchema>;

export const saveWbsSchema = z.object({
  items: z.array(wbsItemSchema).max(WBS_MAX_ITEMS, `Maksimal ${WBS_MAX_ITEMS} item WBS per proyek.`),
  /** Tanggal acuan kurva-S (default: tanggal mulai proyek). */
  startDate: isoDate("Tanggal mulai kurva-S").optional(),
  endDate: isoDate("Tanggal selesai kurva-S").optional(),
  /** `true` = bobot boleh ≠ 100% (draft); `false`/kosong = wajib 100%. */
  allowIncomplete: z.boolean().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export type SaveWbsInput = z.infer<typeof saveWbsSchema>;

export const lockCalendarSchema = z.object({
  action: z.literal("LOCK"),
  reason: z.string().trim().max(300).optional(),
});

export const WBS_LEVELS_VALID = WBS_LEVELS;
