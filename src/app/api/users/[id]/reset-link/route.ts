import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { requestPasswordReset } from "@/modules/auth/password-reset";
import { companyRoute } from "@/shared/auth/route";

/**
 * ADMIN mengirim tautan reset ke email anggota — alternatif yang lebih aman
 * daripada mengetik password baru untuk orang lain (password tidak pernah
 * melintas ke admin).
 *
 * Hanya anggota company ini yang dapat diminta (mencegah admin memicu email ke
 * alamat sembarang). Respons tidak mengembalikan tautan: tautan hanya ada di
 * email pengguna.
 */
async function POSTHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const { id } = await params;
    const [target] = await db.select({ email: users.email })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(memberships.companyId, user.companyId), eq(users.id, id)))
      .limit(1);
    if (!target) throw new ApiError("NOT_FOUND", "Anggota tidak ditemukan pada company ini.", 404);

    const result = await requestPasswordReset(target.email, `admin:${user.id}`);
    return Response.json({
      data: {
        delivered: result.delivered,
        email: target.email,
        // Tautan hanya untuk mode pengembangan (driver console).
        ...(process.env.NODE_ENV === "production" ? {} : { debugLink: result.debugLink, reason: result.reason }),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
