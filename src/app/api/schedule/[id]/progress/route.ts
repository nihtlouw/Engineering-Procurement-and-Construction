import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, progressUpdates, scheduleItems } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D, todayJakarta } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ clientUuid: z.string().min(8), reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), progressPct: z.string(), quantity: z.string().optional(), unitCode: z.string().optional(), note: z.string().min(3), issue: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "progress.create"); const { id } = await params; const body = schema.parse(await request.json());
    const [item] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, id)).limit(1); if (!item) throw new ApiError("NOT_FOUND", "Item jadwal tidak ditemukan.", 404);
    await requireProject(user, item.projectId, "progress.create");
    const [existing] = await db.select().from(progressUpdates).where(eq(progressUpdates.clientUuid, body.clientUuid)).limit(1);
    if (existing) return Response.json({ data: { id: existing.id, idempotent: true } });
    const pct = D(body.progressPct); if (pct.lt(0) || pct.gt(100)) throw new ApiError("INVALID_PROGRESS", "Progres harus antara 0 dan 100 persen.", 422);
    if (pct.lt(item.progressPct) && user.role !== "ADMIN" && user.role !== "PM") throw new ApiError("PROGRESS_REGRESSION", "Penurunan progres hanya dapat dilakukan PM atau admin.", 403);
    const status = pct.gte(100) ? "DONE" : pct.gt(0) ? "IN_PROGRESS" : "NOT_STARTED"; const updateId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(progressUpdates).values({ id: updateId, scheduleItemId: id, projectId: item.projectId, reportDate: body.reportDate || todayJakarta(), progressPct: pct.toFixed(2), quantity: body.quantity, unitCode: body.unitCode, note: body.note, issue: body.issue, createdById: user.id, clientUuid: body.clientUuid });
      await tx.update(scheduleItems).set({ progressPct: pct.toFixed(2), status, actualStart: item.actualStart || (pct.gt(0) ? body.reportDate : null), actualEnd: pct.gte(100) ? body.reportDate : null }).where(eq(scheduleItems.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "SCHEDULE_ITEM", objectId: id, projectId: item.projectId, action: "PROGRESS_UPDATED", changes: [{ field: "progressPct", old: item.progressPct, new: pct.toFixed(2) }, { field: "status", old: item.status, new: status }], reason: body.issue });
    });
    return Response.json({ data: { id: updateId, status } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
