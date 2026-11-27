import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* S4 · template dokumen                                                      */
/* -------------------------------------------------------------------------- */

export const TEMPLATE_KINDS = ["BLOCKS", "DOCX"] as const;
export const VARIABLE_TYPES = ["TEXT", "MONEY", "DATE", "ROW_LIST", "PHOTOS"] as const;

/** Sumber data yang diizinkan saat snapshot. Divalidasi di server agar tag DOCX
 *  tidak bisa dipakai membaca kolom arbitrer. */
export const VARIABLE_SOURCES = [
  "project.code", "project.title", "project.contractNumber", "project.contractValue",
  "project.stage", "project.startDate", "project.targetEndDate",
  "client.legalName", "client.displayName", "client.contactName", "client.address",
  "site.name", "site.address",
  "company.legalName", "company.displayName",
  "pm.name", "user.name",
  "document.date",
  "invoice.number", "invoice.type", "invoice.issueDate", "invoice.dueDate",
  "invoice.dpp", "invoice.ppn", "invoice.total", "invoice.totalInWords",
  "changeOrder.code", "changeOrder.scopeDescription", "changeOrder.reason",
  "changeOrder.priceImpact", "changeOrder.timeImpactDays",
  "budget.rows", "schedule.rows", "progress.pct", "photos.selected",
] as const;

export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export const templateVariableSchema = z.object({
  tag: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,39}$/, {
    message: "Tag variabel 2–40 karakter: huruf/angka/garis bawah, diawali huruf (mis. projectCode).",
  }),
  label: z.string().trim().min(2, "Label variabel minimal 2 karakter.").max(80),
  varType: z.enum(VARIABLE_TYPES).default("TEXT"),
  source: z.enum(VARIABLE_SOURCES),
  sampleValue: z.string().trim().max(200).nullable().optional(),
  isRequired: z.boolean().default(true),
});

export type TemplateVariableInput = z.infer<typeof templateVariableSchema>;

const blocksSchema = z.array(z.record(z.string(), z.unknown())).max(200, "Maksimal 200 blok per template.").optional();

export const templateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,39}$/, {
    message: "Kode template 3–40 karakter: huruf besar, angka, atau garis bawah (mis. BAST1_CUSTOM).",
  }),
  name: z.string().trim().min(3, "Nama template minimal 3 karakter.").max(120),
  description: z.string().trim().max(300).nullable().optional(),
  category: z.string().trim().min(2).max(24).default("OTHER"),
  kind: z.enum(TEMPLATE_KINDS).default("BLOCKS"),
  /** Wajib bila `kind = BLOCKS`: minimal satu blok. */
  blocks: blocksSchema,
  docxFileId: z.string().min(1).nullable().optional(),
  signatureParties: z.array(z.object({
    label: z.string().trim().min(2).max(60),
    name: z.string().trim().max(80).default(""),
    title: z.string().trim().max(80).default(""),
  })).max(4).optional(),
  isActive: z.boolean().default(true),
  variables: z.array(templateVariableSchema).max(60, "Maksimal 60 variabel per template.").default([]),
  /** Kode template yang dijadikan dasar (untuk varian company). */
  baseCode: z.string().trim().max(40).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "BLOCKS" && !(value.blocks?.length)) {
    ctx.addIssue({ code: "custom", path: ["blocks"], message: "Template blok wajib memiliki minimal satu blok." });
  }
  if (value.kind === "DOCX" && !value.docxFileId) {
    ctx.addIssue({ code: "custom", path: ["docxFileId"], message: "Template DOCX wajib memiliki berkas .docx." });
  }
  const tags = value.variables.map((v) => v.tag);
  const duplicates = tags.filter((tag, index) => tags.indexOf(tag) !== index);
  if (duplicates.length) {
    ctx.addIssue({ code: "custom", path: ["variables"], message: `Tag variabel duplikat: ${[...new Set(duplicates)].join(", ")}.` });
  }
});

export type TemplateInput = z.infer<typeof templateSchema>;

/** DOCX admin maksimum 10 MB (dokumen teks, bukan gambar). */
export const DOCX_MAX_BYTES = 10 * 1024 * 1024;

export const archiveDocumentSchema = z.object({
  reason: z.string().trim().min(5, "Alasan arsip minimal 5 karakter.").max(300),
});

export const documentEditSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  blocks: z.array(z.record(z.string(), z.unknown())).min(1, "Dokumen minimal memiliki satu blok.").max(200),
});

/**
 * Daftar tag standar yang boleh dipakai template DOCX bila variabel belum
 * didefinisikan di DB: membuat upload template tetap bisa dipakai tanpa mapping.
 */
export const DEFAULT_TEMPLATE_VARIABLES: { tag: string; label: string; varType: (typeof VARIABLE_TYPES)[number]; source: VariableSource; isRequired: boolean }[] = [
  { tag: "projectCode", label: "Nomor proyek", varType: "TEXT", source: "project.code", isRequired: true },
  { tag: "projectTitle", label: "Nama pekerjaan", varType: "TEXT", source: "project.title", isRequired: true },
  { tag: "clientLegalName", label: "Nama legal klien", varType: "TEXT", source: "client.legalName", isRequired: true },
  { tag: "siteName", label: "Nama site", varType: "TEXT", source: "site.name", isRequired: false },
  { tag: "contractNumber", label: "Nomor kontrak", varType: "TEXT", source: "project.contractNumber", isRequired: false },
  { tag: "contractValue", label: "Nilai kontrak (DPP)", varType: "MONEY", source: "project.contractValue", isRequired: false },
  { tag: "companyLegalName", label: "Nama legal kontraktor", varType: "TEXT", source: "company.legalName", isRequired: true },
  { tag: "pmName", label: "Nama project manager", varType: "TEXT", source: "pm.name", isRequired: false },
  { tag: "documentDate", label: "Tanggal dokumen", varType: "DATE", source: "document.date", isRequired: true },
];

/** Template sistem tidak dapat dihapus/diubah; varian company menyalinnya. */
export const SYSTEM_TEMPLATE_READONLY = "SHARED_CATALOG_READONLY";
