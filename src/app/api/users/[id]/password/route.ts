import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { adminResetPasswordSchema } from "@/modules/companies/validation";
import { resetMemberPassword } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

/**
 * ADMIN mereset password anggota company-nya.
 *
 * Kenapa ada: satu-satunya kasus yang tidak bisa diselesaikan pengguna sendiri
 * adalah lupa password (hash scrypt tidak dapat dibalik). Tanpa jalur ini,
 * pemulihan harus lewat akses langsung ke database.
 *
 * Batasan yang disengaja:
 * - ADMIN hanya dapat mereset anggota pada company-nya (diperiksa di service);
 * - password baru tidak pernah dikembalikan/ditampilkan oleh server;
 * - seluruh sesi target dicabut + akun yang terkunci ikut dibuka;
 * - aksi masuk audit `PASSWORD_RESET` dengan nilai yang di-redaksi.
 */
async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const { id } = await params;
    const body = adminResetPasswordSchema.parse(await request.json());
    const result = await resetMemberPassword(user.companyId, id, body.newPassword, user.id);
    return Response.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
