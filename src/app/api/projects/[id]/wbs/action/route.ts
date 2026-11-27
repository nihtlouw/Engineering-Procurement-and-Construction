import { z } from "zod";
import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { linkBudgetLineToWbs, lockWbsCalendar } from "@/modules/wbs/service";

const schema = z.union([
  z.object({ action: z.literal("LOCK"), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("LINK_BUDGET_LINE"), budgetLineId: z.string().min(1), wbsItemId: z.string().min(1).nullable() }),
]);

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = schema.parse(await request.json());
    if (body.action === "LOCK") return Response.json({ data: await lockWbsCalendar(user, id, body.reason) });
    return Response.json({ data: await linkBudgetLineToWbs(user, id, body.budgetLineId, body.wbsItemId) });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
