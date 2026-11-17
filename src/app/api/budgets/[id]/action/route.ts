import { errorResponse, requireUser } from "@/lib/auth";
import { applyBudgetAction } from "@/modules/budgeting/service";
import { budgetActionSchema } from "@/modules/budgeting/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = budgetActionSchema.parse(await request.json());
    return Response.json({ data: await applyBudgetAction(user, id, body) });
  } catch (error) { return errorResponse(error); }
}
export const POST = companyRoute(POSTHandler);
