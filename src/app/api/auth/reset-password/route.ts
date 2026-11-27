import { z } from "zod";
import { errorResponse } from "@/lib/auth";
import { confirmPasswordReset, inspectResetToken } from "@/modules/auth/password-reset";
import { publicRoute } from "@/shared/auth/route";

/**
 * Verifikasi & penukaran token reset. Route PUBLIK, tetapi tidak pernah
 * mengembalikan data akun melebihi nama/email pemilik tautan — dan hanya bila
 * token-nya sah.
 */
const schema = z.object({ token: z.string().min(32, "Tautan reset tidak valid."), newPassword: z.string().min(1, "Password baru wajib diisi.") });

async function GETHandler(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const result = await inspectResetToken(token);
    return Response.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

async function POSTHandler(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const body = schema.parse(await request.json());
    const result = await confirmPasswordReset(body.token, body.newPassword, ip);
    return Response.json({ data: { email: result.email, message: "Password berhasil diubah. Silakan masuk dengan password baru." } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = publicRoute(GETHandler);
export const POST = publicRoute(POSTHandler);
