import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, expenseLines, expenseSettlements, expenses } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ amount: z.string(), paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(["CASH", "COMPANY_CARD", "BANK_TRANSFER", "PERSONAL", "OTHER"]), reference: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "settlement.manage"); const { id } = await params; const body = schema.parse(await request.json());
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    if (!expense) throw new ApiError("NOT_FOUND", "Pengeluaran tidak ditemukan.", 404);
    if (expense.approvalStatus !== "APPROVED") throw new ApiError("NOT_APPROVED", "Reimburse hanya dapat dibayar setelah pengeluaran disetujui.", 409);
    if (expense.paidByType !== "EMPLOYEE") throw new ApiError("NOT_REIMBURSABLE", "Pengeluaran ini dibayar perusahaan, bukan reimburse karyawan.", 422);
    const [line] = await db.select().from(expenseLines).where(eq(expenseLines.expenseId, id)).limit(1);
    if (line?.projectId) await requireProject(user, line.projectId, "settlement.manage");
    const previous = await db.select().from(expenseSettlements).where(eq(expenseSettlements.expenseId, id));
    const paid = previous.reduce((sum, p) => sum.plus(p.amount), D(0)); const amount = D(body.amount);
    if (amount.lte(0) || paid.plus(amount).gt(expense.totalAmount)) throw new ApiError("INVALID_SETTLEMENT", `Nominal reimburse melebihi sisa ${money(D(expense.totalAmount).minus(paid))}.`, 422);
    const settlementId = newId(); const newPaid = paid.plus(amount); const status = newPaid.gte(expense.totalAmount) ? "SETTLED" : "PARTIAL";
    await db.transaction(async (tx) => {
      await tx.insert(expenseSettlements).values({ id: settlementId, expenseId: id, payeeUserId: expense.paidByUserId!, amount: money(amount), paidDate: body.paidDate, method: body.method, reference: body.reference, createdById: user.id });
      await tx.update(expenses).set({ settlementStatus: status, updatedAt: new Date() }).where(eq(expenses.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "EXPENSE", objectId: id, projectId: line?.projectId, action: "SETTLEMENT_RECORDED", changes: [{ field: "settlementStatus", old: expense.settlementStatus, new: status }, { field: "settlementPaid", old: money(paid), new: money(newPaid) }] });
    });
    return Response.json({ data: { id: settlementId, settlementStatus: status } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
