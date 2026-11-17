import { errorResponse, requireUser } from "@/lib/auth";
import { createVariation } from "@/modules/budgeting/service";
import { createVariationSchema } from "@/modules/budgeting/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = createVariationSchema.parse(await request.json());
    return Response.json({ data: await createVariation(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
export const POST = companyRoute(POSTHandler);
