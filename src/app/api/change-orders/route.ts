import { count, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, changeOrders } from "@/db/schema";
import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ projectId: z.string(), title: z.string().min(5), reason: z.string().min(5), scopeDescription: z.string().min(5), priceImpact: z.string().default("0"), costImpact: z.string().default("0"), timeImpactDays: z.number().int().min(0).default(0) });
export async function POST(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "changeorder.edit"); const body = schema.parse(await request.json()); await requireProject(user, body.projectId, "changeorder.edit");
    const id = newId();
    const code = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771203)`); const [row] = await tx.select({ value: count() }).from(changeOrders);
      const value = `CO-${new Date().getFullYear()}-${String(Number(row.value) + 1).padStart(3, "0")}`;
      await tx.insert(changeOrders).values({ id, projectId: body.projectId, code: value, title: body.title, reason: body.reason, scopeDescription: body.scopeDescription, priceImpact: body.priceImpact, costImpact: body.costImpact, timeImpactDays: body.timeImpactDays, createdById: user.id });
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "CHANGE_ORDER", objectId: id, projectId: body.projectId, action: "CREATED", changes: [{ field: "priceImpact", old: null, new: body.priceImpact }, { field: "costImpact", old: null, new: body.costImpact }] });
      return value;
    });
    return Response.json({ data: { id, code } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
