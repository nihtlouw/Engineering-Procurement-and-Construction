import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, customerInvoices, customerPayments } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { invoiceBalance } from "@/lib/finance";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cashReceivedAmount: z.string(), withholdingTaxAmount: z.string().default("0"), withholdingTaxType: z.string().optional(), method: z.enum(["CASH", "COMPANY_CARD", "BANK_TRANSFER", "PERSONAL", "OTHER"]), reference: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "payment.record"); const { id } = await params; const body = schema.parse(await request.json());
    const [invoice] = await db.select().from(customerInvoices).where(eq(customerInvoices.id, id)).limit(1);
    if (!invoice) throw new ApiError("NOT_FOUND", "Invoice tidak ditemukan.", 404);
    await requireProject(user, invoice.projectId, "payment.record");
    if (!["SENT", "PARTIALLY_PAID"].includes(invoice.status)) throw new ApiError("INVOICE_NOT_SENT", "Pembayaran hanya dapat dicatat untuk invoice yang sudah dikirim dan belum lunas.", 409);
    const payments = await db.select().from(customerPayments).where(eq(customerPayments.invoiceId, id));
    const balance = invoiceBalance({ ...invoice, payments }); const cash = D(body.cashReceivedAmount); const tax = D(body.withholdingTaxAmount);
    if (cash.lt(0) || tax.lt(0) || cash.plus(tax).lte(0)) throw new ApiError("INVALID_PAYMENT", "Total kas dan potongan PPh harus lebih dari nol.", 422);
    if (cash.plus(tax).minus(balance).abs().gt(1) && cash.plus(tax).gt(balance)) throw new ApiError("PAYMENT_EXCEEDS_BALANCE", `Pembayaran melebihi saldo invoice ${money(balance)}.`, 422);
    if (tax.gt(0) && !body.withholdingTaxType) throw new ApiError("TAX_TYPE_REQUIRED", "Jenis PPh wajib diisi jika ada potongan pajak.", 422);
    const next = balance.minus(cash).minus(tax).lte(0) ? "PAID" : "PARTIALLY_PAID"; const paymentId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(customerPayments).values({ id: paymentId, invoiceId: id, paidDate: body.paidDate, cashReceivedAmount: money(cash), withholdingTaxAmount: money(tax), withholdingTaxType: body.withholdingTaxType, method: body.method, reference: body.reference, createdById: user.id });
      await tx.update(customerInvoices).set({ status: next }).where(eq(customerInvoices.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "INVOICE", objectId: id, projectId: invoice.projectId, action: "PAYMENT_RECORDED", changes: [{ field: "cashReceivedAmount", old: null, new: money(cash) }, { field: "withholdingTaxAmount", old: null, new: money(tax) }, { field: "status", old: invoice.status, new: next }] });
    });
    return Response.json({ data: { id: paymentId, invoiceStatus: next, balance: money(balance.minus(cash).minus(tax)) } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
