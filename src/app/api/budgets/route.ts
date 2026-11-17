import { errorResponse, requireUser } from "@/lib/auth";
import { createBudgetVersion } from "@/modules/budgeting/service";
import { createBudgetSchema } from "@/modules/budgeting/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = createBudgetSchema.parse(await request.json());
    return Response.json({ data: await createBudgetVersion(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
export const POST = companyRoute(POSTHandler);
