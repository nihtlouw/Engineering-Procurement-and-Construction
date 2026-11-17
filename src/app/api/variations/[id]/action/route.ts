import { errorResponse, requireUser } from "@/lib/auth";
import { applyVariationAction } from "@/modules/budgeting/service";
import { variationActionSchema } from "@/modules/budgeting/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = variationActionSchema.parse(await request.json());
    return Response.json({ data: await applyVariationAction(user, id, body) });
  } catch (error) { return errorResponse(error); }
}
export const POST = companyRoute(POSTHandler);
