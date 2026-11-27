import { errorResponse, requireUser } from "@/lib/auth";
import { updateUnit } from "@/modules/master-data/service";
import { unitSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = unitSchema.parse(await request.json());
    return Response.json({ data: await updateUnit(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
