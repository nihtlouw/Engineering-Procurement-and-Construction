import { z } from "zod";
import { CODE_PATTERN, PROJECT_ROLES } from "@/modules/master-data/types";

/** Satu sumber kebenaran validasi master data, dipakai UI & server. */

const code = (label: string) =>
  z.string().trim().toUpperCase().regex(CODE_PATTERN, {
    message: `${label} wajib 2–40 karakter: huruf besar, angka, titik, garis bawah, atau strip.`,
  });

const isoDate = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: `${label} harus format YYYY-MM-DD.` });

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** String uang desimal (bukan number JS) — konsisten dengan modul lain. */
const amount = (label: string) =>
  z.string().trim().refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: `${label} harus angka minimal 0 dengan maksimal 2 desimal.`,
  });

export const clientSchema = z.object({
  code: code("Kode klien").optional(),
  legalName: z.string().trim().min(3, "Nama legal minimal 3 karakter.").max(200),
  displayName: z.string().trim().min(2, "Nama tampilan minimal 2 karakter.").max(120),
  industry: z.string().trim().min(2, "Industri minimal 2 karakter.").max(80),
  npwp: optionalText(30),
  address: optionalText(300),
  contactName: optionalText(120),
  contactPhone: optionalText(40),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const siteSchema = z.object({
  clientId: z.string().min(1, "Klien wajib dipilih."),
  name: z.string().trim().min(2, "Nama site minimal 2 karakter.").max(120),
  address: optionalText(300),
  contact: optionalText(120),
  latitude: z.string().trim().refine((v) => !v || /^-?\d{1,3}(\.\d{1,7})?$/.test(v), {
    message: "Latitude harus angka desimal (−90 s/d 90).",
  }).nullable().optional(),
  longitude: z.string().trim().refine((v) => !v || /^-?\d{1,3}(\.\d{1,7})?$/.test(v), {
    message: "Longitude harus angka desimal (−180 s/d 180).",
  }).nullable().optional(),
});
export type SiteInput = z.infer<typeof siteSchema>;

export const projectSchema = z.object({
  code: code("Kode proyek").optional(),
  title: z.string().trim().min(5, "Nama proyek minimal 5 karakter.").max(200),
  clientId: z.string().min(1, "Klien wajib dipilih."),
  siteId: z.string().min(1).nullable().optional(),
  pmId: z.string().min(1).nullable().optional(),
  contractNumber: optionalText(120),
  contractDate: isoDate("Tanggal kontrak").nullable().optional(),
  contractValue: amount("Nilai kontrak"),
  retentionPct: z.string().trim().refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 100, {
    message: "Retensi 0–100%.",
  }).optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  startDate: isoDate("Tanggal mulai").nullable().optional(),
  targetEndDate: isoDate("Target selesai").nullable().optional(),
  members: z.array(z.object({
    userId: z.string().min(1),
    projectRole: z.enum(PROJECT_ROLES),
  })).max(50).optional(),
}).refine(
  (v) => !v.startDate || !v.targetEndDate || v.targetEndDate >= v.startDate,
  { message: "Target selesai tidak boleh sebelum tanggal mulai.", path: ["targetEndDate"] },
).refine(
  (v) => !v.contractDate || !v.startDate || v.startDate >= v.contractDate,
  { message: "Tanggal mulai tidak boleh sebelum tanggal kontrak.", path: ["startDate"] },
);
export type ProjectInput = z.infer<typeof projectSchema>;

export const projectUpdateSchema = z.object({
  title: projectSchema.shape.title.optional(),
  siteId: z.string().min(1).nullable().optional(),
  pmId: z.string().min(1).nullable().optional(),
  contractNumber: optionalText(120),
  contractDate: isoDate("Tanggal kontrak").nullable().optional(),
  contractValue: amount("Nilai kontrak").optional(),
  retentionPct: projectSchema.shape.retentionPct.optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  startDate: isoDate("Tanggal mulai").nullable().optional(),
  targetEndDate: isoDate("Target selesai").nullable().optional(),
}).refine((v) => Object.values(v).some((value) => value !== undefined), {
  message: "Minimal satu field wajib diubah.",
});
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

export const projectMemberSchema = z.object({
  userId: z.string().min(1, "Pengguna wajib dipilih."),
  projectRole: z.enum(PROJECT_ROLES),
});
export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;
