import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, customerInvoices, customerPayments } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { INVOICE_TRANSITIONS } from "@/lib/domain";
import { assertTransition, newId, requireProject, requiredReason } from "@/lib/server-services";

const schema = z.object({ action: z.enum(["APPROVE", "SEND", "CANCEL"]), reason: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await params; const body = schema.parse(await request.json());
    const [invoice] = await db.select().from(customerInvoices).where(eq(customerInvoices.id, id)).limit(1);
    if (!invoice) throw new ApiError("NOT_FOUND", "Invoice tidak ditemukan.", 404);
    await requireProject(user, invoice.projectId, body.action === "APPROVE" ? "invoice.approve" : "invoice.edit");
    const next = assertTransition(INVOICE_TRANSITIONS, invoice.status, body.action);
    if (body.action === "CANCEL") {
      requiredReason(body.reason, "Alasan pembatalan"); assertPermission(user, "invoice.approve");
      const payments = await db.select({ id: customerPayments.id }).from(customerPayments).where(eq(customerPayments.invoiceId, id)).limit(1);
      if (payments.length) throw new ApiError("INVOICE_HAS_PAYMENT", "Invoice dengan pembayaran tidak dapat dibatalkan.", 409);
    }
    await db.transaction(async (tx) => {
      await tx.update(customerInvoices).set({ status: next, sentAt: body.action === "SEND" ? new Date() : invoice.sentAt, cancelReason: body.action === "CANCEL" ? body.reason : null }).where(eq(customerInvoices.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "INVOICE", objectId: id, projectId: invoice.projectId, action: body.action, changes: [{ field: "status", old: invoice.status, new: next }], reason: body.reason });
    });
    return Response.json({ data: { id, status: next } });
  } catch (error) { return errorResponse(error); }
}
