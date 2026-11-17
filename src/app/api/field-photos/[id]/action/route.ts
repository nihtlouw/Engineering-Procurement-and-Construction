import { ApiError, requireUser } from "@/lib/auth";
import { setFieldPhotoSelection } from "@/modules/field-photos/service";
import { fieldPhotoActionSchema } from "@/modules/field-photos/validation";
import { companyRoute } from "@/shared/auth/route";

export const runtime = "nodejs";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!id) throw new ApiError("NOT_FOUND", "Foto lapangan tidak ditemukan.", 404);
  const { action } = fieldPhotoActionSchema.parse(await request.json());
  const result = await setFieldPhotoSelection(user, id, action === "SELECT");
  return Response.json({ data: result });
}

export const POST = companyRoute(POSTHandler);
