import { z } from "zod";
import { ROLES } from "@/lib/domain";

/** Satu sumber kebenaran validasi modul Companies, dipakai UI & server. */
export const inviteSchema = z.object({
  email: z.string().email("Format email tidak valid.").transform((v) => v.toLowerCase()),
  companyRole: z.enum(ROLES),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(32, "Token undangan tidak valid."),
  name: z.string().min(2, "Nama minimal 2 karakter.").max(120),
  password: z.string().min(8, "Password minimal 8 karakter.").max(128),
});

export const updateMemberSchema = z.object({
  companyRole: z.enum(ROLES).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
}).refine((v) => v.companyRole !== undefined || v.status !== undefined, {
  message: "Minimal satu perubahan (peran atau status) wajib diisi.",
});

/**
 * Reset password oleh ADMIN. Kekuatan minimum sengaja lebih tinggi dari
 * pendaftaran (12 vs 8) karena jalur ini melewati verifikasi password lama.
 * Password lama TIDAK pernah dikirim/ditampilkan; hanya hash baru yang disimpan.
 */
export const adminResetPasswordSchema = z.object({
  newPassword: z.string()
    .min(12, "Password baru minimal 12 karakter.")
    .max(128, "Password maksimal 128 karakter.")
    .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), {
      message: "Password harus memuat huruf kecil dan huruf besar.",
    })
    .refine((value) => /\d/.test(value), { message: "Password harus memuat angka." }),
});

/** Ganti password sendiri (wajib menyebut password lama). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Password saat ini wajib diisi.").max(128),
  newPassword: z.string()
    .min(12, "Password baru minimal 12 karakter.")
    .max(128, "Password maksimal 128 karakter.")
    .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), {
      message: "Password harus memuat huruf kecil dan huruf besar.",
    })
    .refine((value) => /\d/.test(value), { message: "Password harus memuat angka." }),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: "Password baru harus berbeda dari password lama.",
});

export const switchCompanySchema = z.object({ companyId: z.string().uuid("ID company tidak valid.") });

export type InviteInput = z.infer<typeof inviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
