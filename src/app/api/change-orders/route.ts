import { companyRoute } from "@/shared/auth/route";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, changeOrders, projects } from "@/db/schema";
import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";
import { coItemSchema } from "@/modules/procurement/validation";

const schema = coItemSchema;
async function POSTHandler(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "changeorder.edit"); const body = schema.parse(await request.json()); await requireProject(user, body.projectId, "changeorder.edit");
    // S2b: dampak sudah boleh negatif, tapi nilai kontrak berjalan tidak boleh < 0.
    const [project] = await db.select({ contractValueCurrent: projects.contractValueCurrent }).from(projects).where(eq(projects.id, body.projectId)).limit(1);
    if (D(project?.contractValueCurrent ?? 0).plus(body.priceImpact).lt(0)) {
      return Response.json({ code: "CONTRACT_VALUE_NEGATIVE", message: "Dampak CO membuat nilai kontrak berjalan negatif." }, { status: 422 });
    }
    const id = newId();
    const code = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771203)`); const [row] = await tx.select({ value: count() }).from(changeOrders);
      const value = `CO-${new Date().getFullYear()}-${String(Number(row.value) + 1).padStart(3, "0")}`;
      await tx.insert(changeOrders).values({ id, projectId: body.projectId, code: value, variationType: body.variationType, title: body.title, reason: body.reason, scopeDescription: body.scopeDescription, priceImpact: body.priceImpact, costImpact: body.costImpact, timeImpactDays: body.timeImpactDays, clientReference: body.clientReference ?? null, evidenceFileId: body.evidenceFileId ?? null, createdById: user.id });
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "CHANGE_ORDER", objectId: id, projectId: body.projectId, action: "CREATED", changes: [{ field: "priceImpact", old: null, new: body.priceImpact }, { field: "costImpact", old: null, new: body.costImpact }] });
      return value;
    });
    return Response.json({ data: { id, code } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
