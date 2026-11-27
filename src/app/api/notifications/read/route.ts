import { companyRoute } from "@/shared/auth/route";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { errorResponse, requireUser } from "@/lib/auth";

/**
 * Audit UX-04: `notifications.read_at` tidak pernah ditulis sehingga badge
 * belum-dibaca menumpuk permanen. Endpoint ini menandai notifikasi milik
 * pengguna sendiri (dijaga policy RESTRICTIVE `notifications_owner_update`
 * dari migrasi 0005), baik semua (`all: true`) maupun id tertentu.
 */
const schema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.string().min(1)).max(200).optional(),
}).refine((v) => v.all === true || (v.ids?.length ?? 0) > 0, {
  message: "Kirim `all: true` atau `ids` berisi minimal satu notifikasi.",
});

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json().catch(() => ({})));
    const now = new Date();
    const marked = await db.update(notifications)
      .set({ readAt: now })
      .where(and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        body.all ? undefined : inArray(notifications.id, body.ids!),
      ))
      .returning({ id: notifications.id });
    return Response.json({ data: { marked: marked.length, readAt: now.toISOString() } });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
