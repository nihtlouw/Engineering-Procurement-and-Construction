import { errorResponse, requireUser } from "@/lib/auth";
import { createCostCategory, listCatalog } from "@/modules/master-data/service";
import { costCategorySchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function GETHandler() {
  try {
    const user = await requireUser();
    return Response.json({ data: await listCatalog(user) });
  } catch (error) { return errorResponse(error); }
}

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = costCategorySchema.parse(await request.json());
    return Response.json({ data: await createCostCategory(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const POST = companyRoute(POSTHandler);
