import { errorResponse, requireUser } from "@/lib/auth";
import { updateProject } from "@/modules/master-data/service";
import { projectUpdateSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = projectUpdateSchema.parse(await request.json());
    return Response.json({ data: await updateProject(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
