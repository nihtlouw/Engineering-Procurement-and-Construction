import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { baseDb, db } from "@/db";
import { activityLogs, companies, invitations, memberships, sessions, users } from "@/db/schema";
import { ApiError, hashPassword, hashToken, verifyPassword } from "@/lib/auth";
import { type Role } from "@/lib/domain";
import type { CompanyView, InviteResult, MemberView, PendingInviteView } from "@/modules/companies/types";
import type { AcceptInviteInput, InviteInput, UpdateMemberInput } from "@/modules/companies/validation";

export { inviteSchema, acceptInviteSchema, updateMemberSchema, switchCompanySchema } from "@/modules/companies/validation";

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

export async function listMembers(companyId: string): Promise<MemberView[]> {
  const rows = await db
    .select({
      membershipId: memberships.id, userId: users.id, name: users.name, email: users.email,
      title: users.title, companyRole: memberships.companyRole, status: memberships.status,
      joinedAt: memberships.joinedAt, invitedBy: memberships.invitedBy, lockedUntil: users.lockedUntil,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.companyId, companyId))
    .orderBy(desc(memberships.createdAt));
  const now = Date.now();
  return rows.map((r) => ({
    ...r, companyRole: r.companyRole as Role, joinedAt: r.joinedAt.toISOString(),
    // Kunci yang sudah lewat waktu tidak ditampilkan: UI hanya perlu tahu yang aktif.
    lockedUntil: r.lockedUntil && r.lockedUntil.getTime() > now ? r.lockedUntil.toISOString() : null,
  }));
}

export async function listPendingInvites(companyId: string): Promise<PendingInviteView[]> {
  const rows = await db.select().from(invitations)
    .where(eq(invitations.companyId, companyId))
    .orderBy(desc(invitations.createdAt));
  return rows.map((r) => ({
    id: r.id, email: r.email, companyRole: r.companyRole as Role,
    expiresAt: r.expiresAt.toISOString(), revoked: !!r.revokedAt, accepted: !!r.acceptedAt,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listCompaniesForUser(userId: string): Promise<CompanyView[]> {
  return db.select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(memberships)
    .innerJoin(companies, eq(companies.id, memberships.companyId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE"), eq(companies.isActive, true)))
    .orderBy(companies.name);
}

/* -------------------------------------------------------------------------- */
/* Undangan                                                                   */
/* -------------------------------------------------------------------------- */

const INVITE_TTL_HOURS = 72;

export async function createInvitation(
  companyId: string, input: InviteInput, actorId: string,
): Promise<InviteResult> {
  const [existingMember] = await db.select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.companyId, companyId), eq(users.email, input.email)))
    .limit(1);
  if (existingMember) throw new ApiError("ALREADY_MEMBER", "Email ini sudah menjadi anggota company.", 409);

  // Cabut undangan lama yang belum dipakai agar hanya satu token yang berlaku.
  await db.update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.companyId, companyId), eq(invitations.email, input.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(invitations).values({
    companyId, email: input.email, companyRole: input.companyRole,
    tokenHash: hashToken(token), invitedBy: actorId, expiresAt,
  });
  await db.insert(activityLogs).values({
    id: randomUUID(), objectType: "MEMBERSHIP", objectId: input.email, action: "USER_INVITED",
    actorId, companyId, changes: [{ field: "companyRole", old: null, new: input.companyRole }],
  });

  return {
    email: input.email, companyRole: input.companyRole as Role, token,
    expiresAt: expiresAt.toISOString(), delivery: "manual",
    acceptPath: `/accept-invite?token=${token}`,
  };
}

/**
 * Menerima undangan. Bila email sudah punya akun global, password yang
 * dikirim HARUS cocok (tidak ada reset password diam-diam). Bila belum,
 * akun dibuat. Semua kontrol-plane, dijalankan dalam satu transaksi polos.
 */
export async function acceptInvitation(input: AcceptInviteInput): Promise<{ userId: string; companyId: string }> {
  const tokenHash = hashToken(input.token);
  return baseDb.transaction(async (tx) => {
    const [invite] = await tx.select().from(invitations)
      .where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (!invite) throw new ApiError("INVITE_INVALID", "Undangan tidak valid, kedaluwarsa, atau sudah dipakai.", 404);

    const [existing] = await tx.select().from(users).where(eq(users.email, invite.email)).limit(1);
    let userId: string;
    if (existing) {
      if (!verifyPassword(input.password, existing.passwordHash)) {
        throw new ApiError("INVALID_CREDENTIALS", "Email sudah terdaftar. Gunakan password akun Anda yang lama.", 401);
      }
      userId = existing.id;
    } else {
      userId = `usr-${randomBytes(12).toString("hex")}`;
      await tx.insert(users).values({
        id: userId, email: invite.email, name: input.name.trim(),
        passwordHash: hashPassword(input.password),
        role: invite.companyRole, title: roleTitle(invite.companyRole as Role),
      });
    }

    const [duplicate] = await tx.select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.companyId, invite.companyId), eq(memberships.userId, userId)))
      .limit(1);
    if (duplicate) throw new ApiError("ALREADY_MEMBER", "Akun ini sudah terdaftar pada company.", 409);

    await tx.insert(memberships).values({
      companyId: invite.companyId, userId, companyRole: invite.companyRole,
      status: "ACTIVE", invitedBy: invite.invitedBy,
    });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
    return { userId, companyId: invite.companyId };
  });
}

/* -------------------------------------------------------------------------- */
/* Manajemen anggota                                                          */
/* -------------------------------------------------------------------------- */

export async function updateMembership(
  companyId: string, targetUserId: string, input: UpdateMemberInput, actor: { id: string; role: Role },
): Promise<{ companyRole: Role; status: string }> {
  const [target] = await db.select().from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, targetUserId)))
    .limit(1);
  if (!target) throw new ApiError("NOT_FOUND", "Anggota tidak ditemukan pada company ini.", 404);

  if (targetUserId === actor.id && (input.status === "SUSPENDED" || (input.companyRole && input.companyRole !== "ADMIN"))) {
    throw new ApiError("SELF_MODIFICATION_DENIED", "Admin tidak dapat menonaktifkan atau menurunkan perannya sendiri.", 409);
  }
  if (target.companyRole === "ADMIN" && target.status === "ACTIVE" &&
      (input.status === "SUSPENDED" || (input.companyRole && input.companyRole !== "ADMIN"))) {
    const [otherAdmin] = await db.select({ id: memberships.id }).from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.companyRole, "ADMIN"), eq(memberships.status, "ACTIVE"), ne(memberships.userId, targetUserId)))
      .limit(1);
    if (!otherAdmin) throw new ApiError("LAST_ADMIN", "Minimal harus ada satu Admin Perusahaan aktif.", 409);
  }

  const nextRole = (input.companyRole ?? target.companyRole) as Role;
  const nextStatus = input.status ?? target.status;
  await db.update(memberships)
    .set({ companyRole: nextRole, status: nextStatus, updatedAt: new Date() })
    .where(eq(memberships.id, target.id));
  await db.insert(activityLogs).values({
    id: randomUUID(), objectType: "MEMBERSHIP", objectId: target.id, action: "MEMBER_UPDATED",
    actorId: actor.id, companyId,
    changes: [
      { field: "companyRole", old: target.companyRole, new: nextRole },
      { field: "status", old: target.status, new: nextStatus },
    ],
  });
  return { companyRole: nextRole, status: nextStatus };
}

/**
 * Membuka kunci login akun anggota (0010). Hanya ADMIN company ini yang boleh;
 * `users.manage` diperiksa di route. Penghitung dikembalikan ke 0 sehingga
 * ambang penguncian dihitung ulang dari awal.
 */
export async function unlockMember(
  companyId: string, targetUserId: string, actorId: string,
): Promise<{ unlocked: boolean; previousFailures: number }> {
  const [target] = await db.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, targetUserId)))
    .limit(1);
  if (!target) throw new ApiError("NOT_FOUND", "Anggota tidak ditemukan pada company ini.", 404);

  const [account] = await baseDb.select({ failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!account) throw new ApiError("NOT_FOUND", "Akun tidak ditemukan.", 404);

  await baseDb.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, targetUserId));
  await db.insert(activityLogs).values({
    id: randomUUID(), objectType: "USER", objectId: targetUserId, action: "LOGIN_UNLOCKED",
    actorId, companyId,
    changes: [{ field: "lockedUntil", old: account.lockedUntil?.toISOString() ?? null, new: null }],
  });
  return { unlocked: true, previousFailures: account.failedLoginCount };
}

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

/** Sesi aktif user ini dicabut — dipakai setiap kali password berubah. */
async function revokeSessions(userId: string, exceptSessionId?: string) {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
    : eq(sessions.userId, userId);
  await baseDb.delete(sessions).where(where);
}

/**
 * ADMIN mereset password anggota company-nya. Password lama tidak diminta
 * (justru kasus pakainya: pengguna lupa), tetapi semua sesi target dicabut dan
 * tindakan ini diaudit — reset password adalah aksi bernilai keamanan tinggi.
 */
export async function resetMemberPassword(
  companyId: string, targetUserId: string, newPassword: string, actorId: string,
): Promise<{ userId: string; sessionsRevoked: number }> {
  const [target] = await db.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, targetUserId)))
    .limit(1);
  if (!target) throw new ApiError("NOT_FOUND", "Anggota tidak ditemukan pada company ini.", 404);

  const active = await baseDb.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, targetUserId));
  await baseDb.update(users).set({
    passwordHash: hashPassword(newPassword),
    // Reset password sekaligus membuka kunci: kalau tidak, pengguna tetap
    // tertahan 15 menit setelah admin menyelesaikan masalahnya.
    failedLoginCount: 0,
    lockedUntil: null,
  }).where(eq(users.id, targetUserId));
  await revokeSessions(targetUserId);
  await db.insert(activityLogs).values({
    id: randomUUID(), objectType: "USER", objectId: targetUserId, action: "PASSWORD_RESET",
    actorId, companyId,
    changes: [{ field: "passwordHash", old: "[redacted]", new: "[redacted]" }],
  });
  return { userId: targetUserId, sessionsRevoked: active.length };
}

/**
 * Ganti password sendiri. Wajib menyebut password lama dan memverifikasinya:
 * sesi yang dibajak tanpa password tidak boleh dapat mengunci pemilik akun.
 */
export async function changeOwnPassword(
  userId: string, currentPassword: string, newPassword: string, currentSessionId?: string,
): Promise<{ sessionsRevoked: number }> {
  const [account] = await baseDb.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) throw new ApiError("NOT_FOUND", "Akun tidak ditemukan.", 404);
  if (!verifyPassword(currentPassword, account.passwordHash)) {
    throw new ApiError("INVALID_CREDENTIALS", "Password saat ini tidak sesuai.", 401);
  }
  const active = await baseDb.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  await baseDb.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, userId));
  // Sesi lain dicabut, sesi sekarang dipertahankan agar pengguna tidak terlempar.
  await revokeSessions(userId, currentSessionId);
  await db.insert(activityLogs).values({
    id: randomUUID(), objectType: "USER", objectId: userId, action: "PASSWORD_CHANGED",
    actorId: userId,
    changes: [{ field: "passwordHash", old: "[redacted]", new: "[redacted]" }],
  });
  return { sessionsRevoked: Math.max(0, active.length - (currentSessionId ? 1 : 0)) };
}

export function roleTitle(role: Role): string {
  const titles: Record<Role, string> = {
    ADMIN: "Admin Perusahaan", ESTIMATOR: "Estimator", PM: "Project Manager",
    FIELD: "Staff Lapangan", PROCUREMENT: "Procurement", FINANCE: "Finance",
    CLIENT_VIEWER: "Client Viewer",
  };
  return titles[role];
}
