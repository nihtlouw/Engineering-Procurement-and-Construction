import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { updateDocumentContent } from "@/modules/documents/service";
import { documentEditSchema } from "@/modules/documents/validation";

/** Edit judul/blok dokumen DRAFT atau IN_REVIEW (dokumen FINAL immutable). */
async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = documentEditSchema.parse(await request.json());
    return Response.json({ data: await updateDocumentContent(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
