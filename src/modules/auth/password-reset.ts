import { randomBytes } from "node:crypto";
import { and, count, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { baseDb, db } from "@/db";
import { activityLogs, authEvents, memberships, passwordResetTokens, sessions, users } from "@/db/schema";
import { ApiError, hashPassword, hashToken, verifyPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/modules/companies/validation";
import { passwordResetEmail, sendEmail, type EmailResult } from "@/modules/notifications/email";

/* ==========================================================================
 * Reset password lewat tautan email (0011)
 *
 * Alur: minta tautan → email berisi token sekali pakai → buka /reset-password
 * → buat password baru → semua sesi dicabut.
 *
 * Prinsip yang dipegang:
 * 1. **Tidak membocorkan keberadaan akun.** Permintaan untuk email yang tidak
 *    terdaftar memberi respons yang sama persis dengan email terdaftar.
 * 2. **Hanya hash token yang disimpan.** Bocornya tabel tidak memberi token.
 * 3. **Sekali pakai + berbatas waktu.** Permintaan baru mencabut token lama.
 * 4. **Password tidak pernah melintas dalam bentuk terbaca** ke admin mana pun.
 * ========================================================================== */

export const RESET_TTL_MINUTES = 30;
/** Batas permintaan per akun per jam — mencegah email bombing ke satu akun. */
export const RESET_REQUESTS_PER_HOUR = 3;

export function resetTtlMinutes() {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? RESET_TTL_MINUTES);
  return Number.isFinite(raw) && raw >= 5 && raw <= 240 ? Math.round(raw) : RESET_TTL_MINUTES;
}

/** Basis URL untuk tautan email. Wajib diisi di production. */
export function appBaseUrl(): string | null {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}

export type ResetRequestResult = {
  /** Selalu true bila permintaan diterima — tidak membocorkan keberadaan akun. */
  accepted: true;
  delivered: boolean;
  /** Diisi hanya pada driver `console` (development) agar pengembang bisa menyalin tautan. */
  debugLink?: string;
  reason?: string;
};

export async function requestPasswordReset(emailInput: string, ip?: string | null): Promise<ResetRequestResult> {
  const email = emailInput.toLowerCase().trim();
  const [account] = await baseDb.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
    .from(users).where(eq(users.email, email)).limit(1);

  // Akun tidak ada / nonaktif: tetap laporkan "diterima" tanpa mengirim apa pun.
  if (!account || !account.isActive) {
    await baseDb.insert(authEvents).values({ email, action: "PASSWORD_RESET_REQUESTED", ipAddress: ip ?? null });
    return { accepted: true, delivered: false, reason: "EMAIL_NOT_ELIGIBLE" };
  }

  const [recent] = await baseDb.select({ value: count() }).from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, account.id), gte(passwordResetTokens.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  if (Number(recent?.value ?? 0) >= RESET_REQUESTS_PER_HOUR) {
    await baseDb.insert(authEvents).values({ email, userId: account.id, action: "RATE_LIMITED", ipAddress: ip ?? null });
    return { accepted: true, delivered: false, reason: "RATE_LIMITED" };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + resetTtlMinutes() * 60_000);

  // Cabut token lama: hanya satu tautan aktif per akun pada satu waktu.
  await baseDb.update(passwordResetTokens).set({ revokedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, account.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.revokedAt)));
  await baseDb.insert(passwordResetTokens).values({
    userId: account.id, tokenHash: hashToken(token), requestedIp: ip ?? null, expiresAt,
  });
  await baseDb.insert(authEvents).values({ email, userId: account.id, action: "PASSWORD_RESET_REQUESTED", ipAddress: ip ?? null });

  const base = appBaseUrl();
  if (!base) {
    // Tanpa basis URL tautan tidak dapat dibentuk; jangan kirim email yang rusak.
    console.error("[reset] APP_BASE_URL belum diisi — tautan reset tidak dapat dibuat.");
    return { accepted: true, delivered: false, reason: "APP_BASE_URL_MISSING" };
  }
  const link = `${base}/reset-password?token=${token}`;
  const message = { ...passwordResetEmail({ name: account.name, link, expiresMinutes: resetTtlMinutes() }), to: account.email };
  const result: EmailResult = await sendEmail(message);

  return {
    accepted: true,
    delivered: result.delivered,
    // Tautan hanya dikembalikan pada driver console (development). Production
    // memakai `resend`, dan tautan tidak boleh masuk log/response.
    ...(result.driver === "console" ? { debugLink: link } : {}),
    ...(result.delivered ? {} : { reason: result.reason }),
  };
}

/** Memeriksa token tanpa menghabiskannya — dipakai halaman untuk menampilkan status. */
export async function inspectResetToken(token: string): Promise<{ valid: boolean; name?: string; email?: string }> {
  if (!token || token.length < 32) return { valid: false };
  const [row] = await baseDb.select({
    id: passwordResetTokens.id, expiresAt: passwordResetTokens.expiresAt,
    name: users.name, email: users.email, isActive: users.isActive,
  })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(and(
      eq(passwordResetTokens.tokenHash, hashToken(token)),
      isNull(passwordResetTokens.usedAt),
      isNull(passwordResetTokens.revokedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ))
    .limit(1);
  if (!row || !row.isActive) return { valid: false };
  return { valid: true, name: row.name, email: row.email };
}

/**
 * Menukar token dengan password baru. Berjalan dalam satu transaksi dengan
 * `SELECT ... FOR UPDATE` pada baris token, sehingga dua permintaan bersamaan
 * dengan token yang sama tidak dapat sama-sama berhasil.
 */
export async function confirmPasswordReset(token: string, newPassword: string, ip?: string | null) {
  const parsed = changePasswordSchema.pick({ newPassword: true }).safeParse({ newPassword });
  if (!parsed.success) {
    throw new ApiError("INVALID_PASSWORD", parsed.error.issues[0]?.message ?? "Password tidak memenuhi syarat.", 422);
  }
  if (!token || token.length < 32) throw new ApiError("RESET_TOKEN_INVALID", "Tautan reset tidak valid.", 400);

  const tokenHash = hashToken(token);
  return baseDb.transaction(async (tx) => {
    const [row] = await tx.select({
      id: passwordResetTokens.id, userId: passwordResetTokens.userId, usedAt: passwordResetTokens.usedAt,
      revokedAt: passwordResetTokens.revokedAt, expiresAt: passwordResetTokens.expiresAt,
    })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .for("update")
      .limit(1);

    if (!row) throw new ApiError("RESET_TOKEN_INVALID", "Tautan reset tidak valid atau sudah diganti.", 400);
    if (row.usedAt) throw new ApiError("RESET_TOKEN_USED", "Tautan ini sudah dipakai. Minta tautan baru.", 409);
    if (row.revokedAt) throw new ApiError("RESET_TOKEN_REVOKED", "Tautan ini sudah dibatalkan karena ada permintaan baru.", 409);
    if (row.expiresAt.getTime() <= Date.now()) throw new ApiError("RESET_TOKEN_EXPIRED", "Tautan sudah kedaluwarsa. Minta tautan baru.", 410);

    const [account] = await tx.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (!account?.isActive) throw new ApiError("ACCOUNT_INACTIVE", "Akun tidak aktif. Hubungi admin perusahaan.", 403);

    await tx.update(users).set({
      passwordHash: hashPassword(newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    }).where(eq(users.id, row.userId));
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    // Semua sesi lama dicabut: pemilik akun harus masuk ulang dengan password baru.
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await tx.insert(authEvents).values({
      email: account.email, userId: row.userId, action: "PASSWORD_RESET_COMPLETED", ipAddress: ip ?? null,
    });

    // Audit per company: activity_logs.company_id NOT NULL, jadi tulis satu baris
    // per company tempat user menjadi anggota (biasanya satu).
    const memberOf = await tx.select({ companyId: memberships.companyId }).from(memberships).where(eq(memberships.userId, row.userId));
    if (memberOf.length) {
      await tx.insert(activityLogs).values(memberOf.map((m) => ({
        id: `audit-${randomBytes(12).toString("hex")}`,
        companyId: m.companyId,
        objectType: "USER", objectId: row.userId, action: "PASSWORD_RESET_SELF",
        changes: [{ field: "passwordHash", old: "[redacted]", new: "[redacted]" }],
        reason: "Reset lewat tautan email",
      })));
    } else {
      // Tidak ada company: tetap catat di control-plane (auth_events sudah mencatat).
      await tx.execute(sql`select set_config('app.current_company_id', '', true)`);
    }
    return { userId: row.userId, email: account.email };
  });
}

/**
 * Mencabut seluruh token aktif milik user. Dipanggil setiap kali password
 * berubah lewat jalur lain (ADMIN reset / ganti sendiri), agar tautan email
 * yang mungkin masih beredar tidak dapat dipakai lagi.
 */
export async function revokeActiveResetTokens(userId: string) {
  await db.update(passwordResetTokens).set({ revokedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.revokedAt)));
}

/** Dipakai halaman login untuk memutuskan apakah tautan "Lupa password" ditampilkan. */
export function resetAvailability() {
  return { configured: Boolean(appBaseUrl()) };
}

export { verifyPassword };
