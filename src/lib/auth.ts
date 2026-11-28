import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { baseDb } from "@/db";
import { companies, memberships, sessions, users } from "@/db/schema";
import { getScope } from "@/shared/db/context";
import { fileSigningSecret } from "@/shared/env";
import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
  type SafeUser,
  type SessionUser,
} from "@/lib/domain";

export const SESSION_COOKIE = "epc_session";
export const SESSION_TTL_HOURS = 12;
export const SESSION_IDLE_MINUTES = 30;

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

/* Implementasi pindah ke `@/lib/passwords` (tanpa `next/headers`, sehingga bisa
   dipakai CLI & tes). Dipertahankan sebagai re-export agar pemanggil lama tidak
   putus. `hashPassword` sekarang ASINKRON: `scryptSync` memblokir event loop
   ~41–88 ms per percobaan login (terukur), yang bisa dipakai penyerang untuk
   memperlambat seluruh instance. Lihat komentar di modul tersebut (audit #7). */
export { hashPasswordAsync as hashPassword, verifyPasswordAsync as verifyPassword, needsRehash, SCRYPT_PARAMS } from "@/lib/passwords";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* -------------------------------------------------------------------------- */
/* Identitas & sesi                                                            */
/* -------------------------------------------------------------------------- */

export function safeUser(user: typeof users.$inferSelect): SafeUser {
  const role = user.role as Role;
  return { id: user.id, name: user.name, email: user.email, role, title: user.title, permissions: ROLE_PERMISSIONS[role] ?? [] };
}

/**
 * Sesi SELALU terikat pada satu company. Role diambil dari memberships
 * (otoritatif), bukan users.role (legacy). Idle 30 menit + absolut 12 jam.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const rows = await baseDb
    .select({
      id: users.id, name: users.name, email: users.email, title: users.title, legacyRole: users.role,
      companyId: sessions.companyId, companyName: companies.name, companyRole: memberships.companyRole,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(
      eq(memberships.companyId, sessions.companyId),
      eq(memberships.userId, users.id),
      eq(memberships.status, "ACTIVE"),
    ))
    .innerJoin(companies, eq(companies.id, sessions.companyId))
    .where(and(
      eq(sessions.id, sessionId),
      gt(sessions.expiresAt, new Date()),
      // Idle timeout memakai konstanta yang sama dengan yang didokumentasikan;
      // sebelumnya angka 30 ditulis dua kali (konstanta + literal) sehingga
      // mengubah konstanta tidak mengubah perilaku.
      gt(sessions.lastSeenAt, sql`now() - make_interval(mins => ${SESSION_IDLE_MINUTES})`),
      eq(users.isActive, true),
      eq(companies.isActive, true),
      isNull(companies.deletedAt),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // Perpanjang idle timeout. Tidak menambah masa absolut sesi.
  await baseDb.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));

  const role = (row.companyRole || row.legacyRole) as Role;
  return {
    id: row.id, name: row.name, email: row.email, title: row.title, role,
    permissions: ROLE_PERMISSIONS[role] ?? [],
    companyId: row.companyId, companyName: row.companyName, companyRole: role,
  };
}

/** Rotasi sesi: login baru mencabut seluruh sesi lama pengguna tersebut. */
export async function createSession(userId: string, companyId: string) {
  const id = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * SESSION_TTL_HOURS);
  await baseDb.delete(sessions).where(eq(sessions.userId, userId));
  await baseDb.insert(sessions).values({ id, userId, companyId, expiresAt, lastSeenAt: now });
  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", expires: expiresAt,
  });
}

/** Id sesi aktif dari cookie (bukan rahasia baru — cookie httpOnly sudah ada). */
export async function getCurrentSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Di dalam withCompany() mengembalikan user dari konteks (tanpa query ulang). */
export async function requireUser(): Promise<SessionUser> {
  const scoped = getScope()?.user;
  if (scoped) return scoped;
  const user = await getCurrentUser();
  if (!user) throw new ApiError("UNAUTHENTICATED", "Sesi berakhir. Silakan masuk kembali.", 401);
  return user;
}

export function hasPermission(user: SafeUser, permission: Permission) {
  return user.permissions.includes(permission);
}

export function assertPermission(user: SafeUser, permission: Permission) {
  if (!hasPermission(user, permission)) throw new ApiError("FORBIDDEN", `Izin ${permission} diperlukan untuk aksi ini.`, 403);
}

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

/** Respons error konsisten + correlation id. Tidak pernah membocorkan error mentah. */
export function errorResponse(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof ApiError) {
    return Response.json({ code: error.code, message: error.message, details: error.details, requestId }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json({
      code: "VALIDATION_ERROR",
      message: "Periksa kembali data yang diisi.",
      details: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
      requestId,
    }, { status: 422 });
  }
  console.error(`[${requestId}] unhandled error:`, error instanceof Error ? error.message : "unknown");
  return Response.json({
    code: "INTERNAL_ERROR", message: "Terjadi kesalahan server. Data tidak diubah.", requestId,
  }, { status: 500 });
}

/* -------------------------------------------------------------------------- */
/* Signed URL file                                                            */
/* -------------------------------------------------------------------------- */

export function signFileToken(fileId: string, expires: number) {
  return createHmac("sha256", fileSigningSecret()).update(`${fileId}.${expires}`).digest("hex");
}
