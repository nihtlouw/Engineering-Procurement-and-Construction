import { companyRoute } from "@/shared/auth/route";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, purchaseRecords } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";
import { receivePurchase, assertPoCancellable } from "@/modules/procurement/service";
import { receivePoSchema } from "@/modules/procurement/validation";

const transitions: Record<string, string[]> = { DRAFT: ["REQUESTED", "CANCELLED"], REQUESTED: ["ORDERED", "CANCELLED"], ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"], PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"], RECEIVED: ["CLOSED"], CLOSED: [], CANCELLED: [] };
const schema = z.object({
  to: z.string().optional(),
  poNumber: z.string().optional(),
  action: z.literal("RECEIVE").optional(),
  items: z.array(z.object({ itemId: z.string().min(1), receivedQty: z.string() })).optional(),
}).refine((v) => (v.action === "RECEIVE" ? !!v.items?.length : !!v.to), { message: "Kirim `to` untuk transisi status atau `action: RECEIVE` + `items`." });
async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "purchase.edit"); const { id } = await params; const body = schema.parse(await request.json());
    if (body.action === "RECEIVE") {
      const parsedItems = receivePoSchema.parse({ action: "RECEIVE", items: body.items });
      const result = await receivePurchase(user, id, parsedItems.items);
      return Response.json({ data: result });
    }
    const to = body.to as string;
    const [po] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, id)).limit(1); if (!po) throw new ApiError("NOT_FOUND", "PO tidak ditemukan.", 404);
    await requireProject(user, po.projectId, "purchase.edit");
    if (!transitions[po.status]?.includes(to)) throw new ApiError("INVALID_TRANSITION", `Perubahan ${po.status} ke ${to} tidak diizinkan.`, 409);
    if (to === "ORDERED" && !(body.poNumber || po.poNumber)) throw new ApiError("PO_NUMBER_REQUIRED", "Nomor PO wajib sebelum dipesan.", 422);
    // DOM-08: PO dengan tagihan aktif tidak boleh dibatalkan (komitmen hilang dari metrik).
    await assertPoCancellable(po.id, po.status, to);
    await db.transaction(async (tx) => {
      await tx.update(purchaseRecords).set({ status: to, poNumber: body.poNumber || po.poNumber }).where(eq(purchaseRecords.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PURCHASE", objectId: id, projectId: po.projectId, action: "STATUS_CHANGED", changes: [{ field: "status", old: po.status, new: to }] });
    });
    return Response.json({ data: { id, status: to } });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
