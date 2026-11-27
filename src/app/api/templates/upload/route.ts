import { companyRoute } from "@/shared/auth/route";
import { ApiError, errorResponse, requireUser } from "@/lib/auth";
import { uploadTemplateDocx } from "@/modules/documents/templates";

/** Unggah berkas .docx template (multipart). Maksimal 10 MB, divalidasi magic bytes. */
async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("FILE_REQUIRED", "Berkas .docx wajib dilampirkan.", 422);
    const buffer = Buffer.from(await file.arrayBuffer());
    return Response.json({ data: await uploadTemplateDocx(user, { buffer, fileName: file.name }) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
