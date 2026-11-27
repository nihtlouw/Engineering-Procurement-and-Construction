import { count, eq, and, gte } from "drizzle-orm";
import { z } from "zod";
import { baseDb } from "@/db";
import { authEvents } from "@/db/schema";
import { errorResponse } from "@/lib/auth";
import { requestPasswordReset } from "@/modules/auth/password-reset";
import { publicRoute } from "@/shared/auth/route";

/**
 * Permintaan tautan reset password. Route PUBLIK (pengguna belum masuk).
 *
 * Perlindungan yang dipakai:
 * - respons selalu sama (tidak membocorkan email terdaftar/tidak);
 * - rate limit per IP berbasis tabel auth_events (bukan Map per instance);
 * - batas 3 permintaan per akun per jam di service.
 */
const schema = z.object({ email: z.string().email("Format email tidak valid.").max(200) });
const MAX_PER_IP_PER_HOUR = 10;

async function POSTHandler(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const [recent] = await baseDb.select({ value: count() }).from(authEvents)
      .where(and(
        eq(authEvents.action, "PASSWORD_RESET_REQUESTED"),
        eq(authEvents.ipAddress, ip),
        gte(authEvents.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ));
    if (Number(recent?.value ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return Response.json({ code: "RATE_LIMITED", message: "Terlalu banyak permintaan dari jaringan ini. Coba lagi nanti." }, { status: 429 });
    }

    const result = await requestPasswordReset(email, ip);
    // `debugLink` hanya muncul pada driver console (development).
    return Response.json({
      data: {
        message: "Bila email itu terdaftar, tautan pengaturan password sudah dikirim.",
        ...(process.env.NODE_ENV === "production" ? {} : { debugLink: result.debugLink, delivered: result.delivered, reason: result.reason }),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = publicRoute(POSTHandler);
