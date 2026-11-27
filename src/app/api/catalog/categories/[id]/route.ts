import { errorResponse, requireUser } from "@/lib/auth";
import { updateCostCategory } from "@/modules/master-data/service";
import { costCategorySchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = costCategorySchema.parse(await request.json());
    return Response.json({ data: await updateCostCategory(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
