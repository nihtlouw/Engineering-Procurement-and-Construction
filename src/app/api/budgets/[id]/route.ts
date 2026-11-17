import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, budgetVersions } from "@/db/schema";
import { ApiError, errorResponse, requireUser } from "@/lib/auth";
import { updateBudgetVersion } from "@/modules/budgeting/service";
import { updateBudgetSchema } from "@/modules/budgeting/validation";
import { companyRoute } from "@/shared/auth/route";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;
    const [version] = await db.select().from(budgetVersions).where(eq(budgetVersions.id, id)).limit(1);
    if (!version) throw new ApiError("NOT_FOUND", "Versi RAB tidak ditemukan.", 404);
    const lines = await db.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, id)).orderBy(asc(budgetLines.sortOrder));
    return Response.json({ data: { ...version, lines } });
  } catch (error) { return errorResponse(error); }
}

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = updateBudgetSchema.parse(await request.json());
    return Response.json({ data: await updateBudgetVersion(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const PATCH = companyRoute(PATCHHandler);
