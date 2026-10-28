import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { ROLE_PERMISSIONS, type Permission, type Role, type SafeUser } from "@/lib/domain";

export const SESSION_COOKIE = "epc_session";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

export function safeUser(user: typeof users.$inferSelect): SafeUser {
  const role = user.role as Role;
  return { id: user.id, name: user.name, email: user.email, role, title: user.title, permissions: ROLE_PERMISSIONS[role] ?? [] };
}

export async function getCurrentUser() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const rows = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), eq(users.isActive, true))).limit(1);
  return rows[0] ? safeUser(rows[0].user) : null;
}

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await db.insert(sessions).values({ id, userId, expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export function hasPermission(user: SafeUser, permission: Permission) {
  return user.permissions.includes(permission);
}

export function assertPermission(user: SafeUser, permission: Permission) {
  if (!hasPermission(user, permission)) throw new ApiError("FORBIDDEN", `Izin ${permission} diperlukan untuk aksi ini.`, 403);
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError("UNAUTHENTICATED", "Sesi berakhir. Silakan masuk kembali.", 401);
  return user;
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ code: error.code, message: error.message, details: error.details }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError") return Response.json({ code: "VALIDATION_ERROR", message: "Periksa kembali data yang diisi.", details: error }, { status: 422 });
  console.error(error);
  return Response.json({ code: "INTERNAL_ERROR", message: "Terjadi kesalahan server. Data tidak diubah." }, { status: 500 });
}

export function signFileToken(fileId: string, expires: number) {
  const secret = process.env.FILE_SIGNING_SECRET || process.env.DATABASE_URL || "local-epc-file-secret";
  return createHmac("sha256", secret).update(`${fileId}.${expires}`).digest("hex");
}
