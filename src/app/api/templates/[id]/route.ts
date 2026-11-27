import { companyRoute } from "@/shared/auth/route";
import { ApiError, errorResponse, requireUser } from "@/lib/auth";
import { getTemplate, listTemplateVersions, updateTemplate } from "@/modules/documents/templates";
import { templateSchema } from "@/modules/documents/validation";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const template = await getTemplate(id);
    if (template.companyId !== null) {
      // Template company hanya boleh dibaca company pemiliknya (RLS tidak aktif).
      const user = await requireUser();
      if (template.companyId !== user.companyId) throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
    }
    return Response.json({ data: { template, versions: await listTemplateVersions(id) } });
  } catch (error) { return errorResponse(error); }
}

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = templateSchema.parse(await request.json());
    return Response.json({ data: await updateTemplate(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const PATCH = companyRoute(PATCHHandler);
