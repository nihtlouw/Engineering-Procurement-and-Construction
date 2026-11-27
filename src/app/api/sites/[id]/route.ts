import { errorResponse, requireUser } from "@/lib/auth";
import { updateSite } from "@/modules/master-data/service";
import { siteSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = siteSchema.parse(await request.json());
    return Response.json({ data: await updateSite(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
