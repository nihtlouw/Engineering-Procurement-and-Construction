import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, changeOrders } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject, requiredReason } from "@/lib/server-services";

const transitions: Record<string, Record<string, string>> = { DRAFT: { SUBMIT: "INTERNAL_REVIEW" }, INTERNAL_REVIEW: { SEND_CLIENT: "AWAITING_CLIENT", RETURN: "DRAFT", APPROVE: "APPROVED", REJECT: "REJECTED" }, AWAITING_CLIENT: { APPROVE: "APPROVED", REJECT: "REJECTED" }, APPROVED: {}, REJECTED: {}, IMPLEMENTED: {} };
const schema = z.object({ action: z.enum(["SUBMIT", "SEND_CLIENT", "RETURN", "APPROVE", "REJECT"]), reason: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await params; const body = schema.parse(await request.json());
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, id)).limit(1); if (!co) throw new ApiError("NOT_FOUND", "Change order tidak ditemukan.", 404);
    await requireProject(user, co.projectId, ["APPROVE", "REJECT"].includes(body.action) ? "changeorder.approve" : "changeorder.edit");
    const next = transitions[co.status]?.[body.action]; if (!next) throw new ApiError("INVALID_TRANSITION", `Aksi tidak valid untuk status ${co.status}.`, 409);
    if (["RETURN", "REJECT"].includes(body.action)) requiredReason(body.reason, "Alasan");
    if (co.createdById === user.id && ["APPROVE", "REJECT"].includes(body.action) && user.role !== "ADMIN") throw new ApiError("SEPARATION_OF_DUTY", "Pembuat change order tidak dapat memutuskannya sendiri.", 403);
    await db.transaction(async (tx) => {
      await tx.update(changeOrders).set({ status: next }).where(eq(changeOrders.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "CHANGE_ORDER", objectId: id, projectId: co.projectId, action: body.action, changes: [{ field: "status", old: co.status, new: next }], reason: body.reason });
    });
    return Response.json({ data: { id, status: next } });
  } catch (error) { return errorResponse(error); }
}
