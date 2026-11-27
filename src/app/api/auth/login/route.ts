import { and, asc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { baseDb } from "@/db";
import { authEvents, companies, memberships, users } from "@/db/schema";
import { createSession, errorResponse, safeUser, verifyPassword } from "@/lib/auth";
import { ROLE_PERMISSIONS, type Role } from "@/lib/domain";
import { publicRoute } from "@/shared/auth/route";

const schema = z.object({
  email: z.string().email("Format email tidak valid."),
  password: z.string().min(8, "Password minimal 8 karakter."),
});

const MAX_FAILURES_PER_MINUTE = 8;
const WINDOW_MS = 60_000;
/* 0010: ambang kunci akun. 10 kegagalan → 15 menit, 20 → 60 menit.
   Penghitung bertahan di DB sehingga tidak hilang saat instance Vercel didaur. */
const LOCK_THRESHOLDS = [
  { failures: 20, minutes: 60 },
  { failures: 10, minutes: 15 },
];
export function lockMinutesFor(failures: number): number {
  return LOCK_THRESHOLDS.find((threshold) => failures >= threshold.failures)?.minutes ?? 0;
}

async function recordAuthEvent(input: {
  email: string; action: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "RATE_LIMITED" | "ACCOUNT_LOCKED";
  userId?: string; companyId?: string; ip?: string;
}) {
  await baseDb.insert(authEvents).values({
    email: input.email.toLowerCase(), action: input.action,
    userId: input.userId ?? null, companyId: input.companyId ?? null,
    ipAddress: input.ip ?? null,
  });
}

async function POSTHandler(request: Request) {
  try {
    // S1: seed TIDAK lagi dijalankan dari request. Akun demo hanya lewat
    // `npm run db:seed:demo` (CLI, ditolak di production).
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();

    // Rate limit terdistribusi berbasis tabel (bukan Map per instance Vercel).
    const [recent] = await baseDb
      .select({ value: count() })
      .from(authEvents)
      .where(and(
        eq(authEvents.action, "LOGIN_FAILED"),
        eq(authEvents.email, email),
        gte(authEvents.createdAt, new Date(Date.now() - WINDOW_MS)),
      ));
    if (Number(recent?.value ?? 0) >= MAX_FAILURES_PER_MINUTE) {
      await recordAuthEvent({ email, action: "RATE_LIMITED", ip });
      return Response.json({ code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi dalam 1 menit." }, { status: 429 });
    }

    const [user] = await baseDb.select().from(users).where(eq(users.email, email)).limit(1);

    // Akun terkunci: SELALU ditolak sebelum verifikasi password, dan tidak
    // menambah penghitung (supaya penyerang tidak memperpanjang kunci sendiri).
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await recordAuthEvent({ email, action: "RATE_LIMITED", ip, userId: user.id });
      return Response.json({
        code: "ACCOUNT_LOCKED",
        message: `Akun terkunci sementara karena percobaan gagal berulang. Coba lagi setelah ${user.lockedUntil.toISOString().slice(11, 16)} UTC.`,
      }, { status: 423 });
    }

    if (!user || !user.isActive || !verifyPassword(body.password, user.passwordHash)) {
      // Hitung kegagalan per akun; hanya untuk email yang benar-benar terdaftar
      // supaya pesan error tetap seragam (tidak membocorkan keberadaan akun).
      if (user) {
        const failures = user.failedLoginCount + 1;
        const lockMinutes = lockMinutesFor(failures);
        await baseDb.update(users).set({
          failedLoginCount: failures,
          lockedUntil: lockMinutes ? new Date(Date.now() + lockMinutes * 60_000) : null,
        }).where(eq(users.id, user.id));
        if (lockMinutes) {
          await recordAuthEvent({ email, action: "ACCOUNT_LOCKED", ip, userId: user.id });
        }
      }
      await recordAuthEvent({ email, action: "LOGIN_FAILED", ip });
      return Response.json({ code: "INVALID_CREDENTIALS", message: "Email atau password tidak sesuai." }, { status: 401 });
    }

    // Login berhasil: bersihkan penghitung + kunci.
    if (user.failedLoginCount || user.lockedUntil) {
      await baseDb.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
    }

    // Role & company diambil dari keanggotaan AKTIF, bukan dari users.role.
    const activeMemberships = await baseDb
      .select({ companyId: memberships.companyId, companyRole: memberships.companyRole, companyName: companies.name })
      .from(memberships)
      .innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, "ACTIVE"), eq(companies.isActive, true)))
      .orderBy(asc(memberships.createdAt));

    if (!activeMemberships.length) {
      await recordAuthEvent({ email, action: "LOGIN_FAILED", ip, userId: user.id });
      return Response.json({ code: "NO_ACTIVE_MEMBERSHIP", message: "Akun ini belum terdaftar pada company aktif. Hubungi admin perusahaan." }, { status: 403 });
    }

    const membership = activeMemberships[0];
    await createSession(user.id, membership.companyId);
    await recordAuthEvent({ email, action: "LOGIN_SUCCESS", ip, userId: user.id, companyId: membership.companyId });
    const role = membership.companyRole as Role;
    return Response.json({ data: {
      ...safeUser(user), role, permissions: ROLE_PERMISSIONS[role] ?? [],
      companyId: membership.companyId, companyName: membership.companyName, companyRole: role,
    } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = publicRoute(POSTHandler);
