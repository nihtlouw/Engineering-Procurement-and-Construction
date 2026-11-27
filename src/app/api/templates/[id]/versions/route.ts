import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { listTemplateVersions } from "@/modules/documents/templates";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    return Response.json({ data: await listTemplateVersions(id) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
