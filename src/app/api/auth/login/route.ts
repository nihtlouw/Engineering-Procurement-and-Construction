import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ensureSeed } from "@/db/seed";
import { users } from "@/db/schema";
import { createSession, errorResponse, safeUser, verifyPassword } from "@/lib/auth";

const schema = z.object({ email: z.string().email("Format email tidak valid."), password: z.string().min(8, "Password minimal 8 karakter.") });
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  try {
    await ensureSeed();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
    const now = Date.now();
    const attempt = attempts.get(ip);
    if (attempt && attempt.resetAt > now && attempt.count >= 8) return Response.json({ code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi dalam 1 menit." }, { status: 429 });
    const body = schema.parse(await request.json());
    const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    if (!user || !user.isActive || !verifyPassword(body.password, user.passwordHash)) {
      attempts.set(ip, { count: (attempt?.resetAt && attempt.resetAt > now ? attempt.count : 0) + 1, resetAt: now + 60_000 });
      return Response.json({ code: "INVALID_CREDENTIALS", message: "Email atau password tidak sesuai." }, { status: 401 });
    }
    attempts.delete(ip);
    await createSession(user.id);
    return Response.json({ data: safeUser(user) });
  } catch (error) { return errorResponse(error); }
}
