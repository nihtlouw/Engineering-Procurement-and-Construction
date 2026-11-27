import { errorResponse, getCurrentSessionId, requireUser } from "@/lib/auth";
import { changeOwnPassword } from "@/modules/companies/service";
import { changePasswordSchema } from "@/modules/companies/validation";
import { companyRoute } from "@/shared/auth/route";

/**
 * Ganti password sendiri. Wajib menyebut password lama supaya sesi yang
 * dibajak tidak dapat mengambil alih akun. Sesi lain dicabut, sesi yang dipakai
 * sekarang dipertahankan agar pengguna tidak terlempar keluar.
 */
async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = changePasswordSchema.parse(await request.json());
    const sessionId = await getCurrentSessionId();
    const result = await changeOwnPassword(user.id, body.currentPassword, body.newPassword, sessionId ?? undefined);
    return Response.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
