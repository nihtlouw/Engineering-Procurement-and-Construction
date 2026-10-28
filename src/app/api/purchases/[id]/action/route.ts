import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, purchaseRecords } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";

const transitions: Record<string, string[]> = { DRAFT: ["REQUESTED", "CANCELLED"], REQUESTED: ["ORDERED", "CANCELLED"], ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"], PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"], RECEIVED: ["CLOSED"], CLOSED: [], CANCELLED: [] };
const schema = z.object({ to: z.string(), poNumber: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "purchase.edit"); const { id } = await params; const body = schema.parse(await request.json());
    const [po] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, id)).limit(1); if (!po) throw new ApiError("NOT_FOUND", "PO tidak ditemukan.", 404);
    await requireProject(user, po.projectId, "purchase.edit");
    if (!transitions[po.status]?.includes(body.to)) throw new ApiError("INVALID_TRANSITION", `Perubahan ${po.status} ke ${body.to} tidak diizinkan.`, 409);
    if (body.to === "ORDERED" && !(body.poNumber || po.poNumber)) throw new ApiError("PO_NUMBER_REQUIRED", "Nomor PO wajib sebelum dipesan.", 422);
    await db.transaction(async (tx) => {
      await tx.update(purchaseRecords).set({ status: body.to, poNumber: body.poNumber || po.poNumber }).where(eq(purchaseRecords.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PURCHASE", objectId: id, projectId: po.projectId, action: "STATUS_CHANGED", changes: [{ field: "status", old: po.status, new: body.to }] });
    });
    return Response.json({ data: { id, status: body.to } });
  } catch (error) { return errorResponse(error); }
}
