import { z } from "zod";

export const PHOTO_CATEGORIES = ["BEFORE", "PROCESS", "AFTER"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const PHOTO_CATEGORY_ORDER: Record<string, number> = { BEFORE: 0, PROCESS: 1, AFTER: 2 };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoMime = (typeof PHOTO_MIME_TYPES)[number] | "image/heic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD.");

export const fieldPhotoUploadSchema = z.object({
  projectId: z.string().min(1),
  category: z.enum(PHOTO_CATEGORIES),
  capturedAt: date,
  description: z.string().trim().max(300).optional().nullable(),
  locationLabel: z.string().trim().max(120).optional().nullable(),
});
export type FieldPhotoUploadInput = z.infer<typeof fieldPhotoUploadSchema>;

const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), date.optional());
const optionalCategory = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(PHOTO_CATEGORIES).optional());
const optionalBool = z.enum(["0", "1", "true", "false"]).default("false")
  .transform((v) => v === "1" || v === "true");

export const fieldPhotoFilterSchema = z.object({
  projectId: z.string().min(1),
  from: optionalDate,
  to: optionalDate,
  category: optionalCategory,
  selectedOnly: optionalBool,
});
export type FieldPhotoFilter = z.infer<typeof fieldPhotoFilterSchema>;

export const fieldPhotoActionSchema = z.object({
  action: z.enum(["SELECT", "UNSELECT"]),
});
