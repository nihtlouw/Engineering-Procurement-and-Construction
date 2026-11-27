import { z } from "zod";
import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { unlockMember } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

/**
 * Aksi administratif pada akun anggota (0010): membuka kunci login.
 * Sengaja terpisah dari PATCH /api/users/[id] (yang mengubah peran/status)
 * karena membuka kunci tidak mengubah keanggotaan, hanya penghitung kegagalan.
 */
const schema = z.object({ action: z.literal("UNLOCK") });

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const { id } = await params;
    schema.parse(await request.json());
    const result = await unlockMember(user.companyId, id, user.id);
    return Response.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
