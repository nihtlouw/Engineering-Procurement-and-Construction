import { z } from "zod";
import { db } from "@/db";
import { activityLogs, purchaseRecords } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ projectId: z.string(), supplierName: z.string().min(2), poNumber: z.string().optional(), summary: z.string().min(5), dppAmount: z.string(), ppnAmount: z.string().default("0"), orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), budgetLineId: z.string().nullable().optional(), status: z.enum(["DRAFT", "REQUESTED", "ORDERED"]).default("DRAFT") });
export async function POST(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "purchase.edit"); const body = schema.parse(await request.json()); await requireProject(user, body.projectId, "purchase.edit");
    if (D(body.dppAmount).lte(0) || D(body.ppnAmount).lt(0)) throw new ApiError("INVALID_AMOUNT", "Nilai DPP PO harus positif.", 422);
    if (body.status === "ORDERED" && !body.poNumber) throw new ApiError("PO_NUMBER_REQUIRED", "Nomor PO wajib diisi sebelum status Dipesan.", 422);
    const id = newId(); const total = D(body.dppAmount).plus(body.ppnAmount);
    await db.transaction(async (tx) => {
      await tx.insert(purchaseRecords).values({ id, projectId: body.projectId, supplierName: body.supplierName, poNumber: body.poNumber, summary: body.summary, dppAmount: money(body.dppAmount), ppnAmount: money(body.ppnAmount), totalAmount: money(total), orderDate: body.orderDate, expectedDate: body.expectedDate, budgetLineId: body.budgetLineId, status: body.status, createdById: user.id });
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PURCHASE", objectId: id, projectId: body.projectId, action: "CREATED", changes: [{ field: "dppAmount", old: null, new: money(body.dppAmount) }, { field: "status", old: null, new: body.status }] });
    });
    return Response.json({ data: { id } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
