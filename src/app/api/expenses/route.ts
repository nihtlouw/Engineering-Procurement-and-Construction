import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, budgetVersions, companySettings, expenseLines, expenses, fileObjects, purchaseRecords, users } from "@/db/schema";
import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const lineSchema = z.object({
  scope: z.enum(["PROJECT", "OVERHEAD"]).default("PROJECT"), projectId: z.string().nullable().optional(),
  costCategoryId: z.string().min(1, "Kategori wajib dipilih."), budgetLineId: z.string().nullable().optional(),
  description: z.string().min(3, "Uraian baris minimal 3 karakter."), quantity: z.string().default("1"),
  unitCode: z.string().default("Ls"), unitPrice: z.string(), discountAmount: z.string().default("0"),
});
const schema = z.object({
  clientUuid: z.string().min(8), type: z.enum(["FIELD_EXPENSE", "PO_BILL"]).default("FIELD_EXPENSE"),
  defaultScope: z.enum(["PROJECT", "OVERHEAD"]).default("PROJECT"), defaultProjectId: z.string().nullable().optional(),
  purchaseRecordId: z.string().nullable().optional(), merchantName: z.string().min(2), receiptNumber: z.string().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), originalCurrency: z.string().length(3).default("IDR"),
  exchangeRate: z.string().default("1"), originalAmount: z.string().optional(), discountAmount: z.string().default("0"),
  ppnAmount: z.string().default("0"), totalAmount: z.string(), mismatchReason: z.string().optional(),
  overBillReason: z.string().optional(), paymentMethod: z.enum(["CASH", "COMPANY_CARD", "BANK_TRANSFER", "PERSONAL", "OTHER"]),
  paidByType: z.enum(["COMPANY", "EMPLOYEE"]), paidByUserId: z.string().nullable().optional(), note: z.string().optional(),
  receiptFileId: z.string().nullable().optional(), lines: z.array(lineSchema).min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "expense.create");
    const body = schema.parse(await request.json());
    const [duplicateClient] = await db.select().from(expenses).where(eq(expenses.clientUuid, body.clientUuid)).limit(1);
    if (duplicateClient) return Response.json({ data: { id: duplicateClient.id, code: duplicateClient.code, idempotent: true } });
    if (body.paidByType === "EMPLOYEE" && !body.paidByUserId) return Response.json({ code: "PAYEE_REQUIRED", message: "Pilih karyawan yang membayar untuk kebutuhan reimburse." }, { status: 422 });
    const rate = D(body.exchangeRate); if (rate.lte(0)) return Response.json({ code: "INVALID_RATE", message: "Kurs harus lebih dari nol." }, { status: 422 });
    const [settings] = await db.select().from(companySettings).limit(1);
    const rawLines = body.lines.map((line) => ({ ...line, scope: settings?.allowSplitExpense ? line.scope : body.defaultScope, projectId: settings?.allowSplitExpense ? line.projectId : body.defaultProjectId }));
    for (const line of rawLines) {
      if (line.scope === "PROJECT") {
        if (!line.projectId) return Response.json({ code: "PROJECT_REQUIRED", message: "Setiap baris biaya proyek wajib memiliki proyek." }, { status: 422 });
        await requireProject(user, line.projectId);
      } else if (line.projectId) line.projectId = null;
      if (D(line.quantity).lte(0) || D(line.unitPrice).lt(0)) return Response.json({ code: "INVALID_LINE", message: "Kuantitas harus positif dan harga tidak boleh negatif." }, { status: 422 });
    }
    if (body.receiptFileId) {
      const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, body.receiptFileId)).limit(1);
      if (!file || file.uploadedById !== user.id) return Response.json({ code: "FILE_NOT_FOUND", message: "File nota tidak tersedia untuk akun ini." }, { status: 422 });
    }
    const rawTotals = rawLines.map((line) => D(line.quantity).times(line.unitPrice).minus(line.discountAmount).times(rate));
    const subtotal = rawTotals.reduce((sum, value) => sum.plus(value), D(0));
    const headerDiscount = D(body.discountAmount).times(rate);
    if (headerDiscount.gt(subtotal)) return Response.json({ code: "DISCOUNT_TOO_LARGE", message: "Diskon tidak boleh melebihi subtotal." }, { status: 422 });
    let allocated = D(0);
    const finalTotals = rawTotals.map((value, index) => {
      const share = index === rawTotals.length - 1 ? headerDiscount.minus(allocated) : (subtotal.gt(0) ? headerDiscount.times(value).div(subtotal).toDecimalPlaces(2) : D(0));
      allocated = allocated.plus(share); return value.minus(share).toDecimalPlaces(2);
    });
    const dpp = finalTotals.reduce((sum, value) => sum.plus(value), D(0));
    const ppn = D(body.ppnAmount); const expectedTotal = dpp.plus(ppn); const receiptTotal = D(body.totalAmount);
    if (expectedTotal.minus(receiptTotal).abs().gt(1) && (!body.mismatchReason || body.mismatchReason.trim().length < 5)) {
      return Response.json({ code: "MISMATCH_REASON_REQUIRED", message: `Selisih ${money(expectedTotal.minus(receiptTotal).abs())} memerlukan alasan pada kolom ketidaksesuaian.`, details: { expectedTotal: money(expectedTotal), receiptTotal: money(receiptTotal) } }, { status: 422 });
    }
    const projectIds = [...new Set(rawLines.filter((l) => l.scope === "PROJECT" && l.projectId).map((l) => l.projectId!))];
    const baselines = await db.select().from(budgetVersions).where(and(eq(budgetVersions.type, "INTERNAL"), eq(budgetVersions.isActiveBaseline, true)));
    const isPreBaseline = projectIds.some((id) => !baselines.some((b) => b.projectId === id));
    const duplicates = await db.select().from(expenses).where(and(eq(expenses.merchantName, body.merchantName), eq(expenses.receiptNumber, body.receiptNumber || ""), eq(expenses.transactionDate, body.transactionDate), ne(expenses.approvalStatus, "VOIDED")));
    const warnings = duplicates.length ? [`Peringatan: merchant, nomor nota, dan tanggal sama dengan ${duplicates.map((d) => d.code).join(", ")}.`] : [];
    if (body.type === "FIELD_EXPENSE" && projectIds.length) {
      const openPurchases = await db.select().from(purchaseRecords);
      const matching = openPurchases.filter((po) => projectIds.includes(po.projectId) && ["REQUESTED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status) && po.supplierName.trim().toLowerCase() === body.merchantName.trim().toLowerCase());
      if (matching.length) warnings.push(`Peringatan BR-10: pemasok memiliki PO terbuka (${matching.map((po) => po.poNumber || po.id).join(", ")}). Pastikan transaksi ini bukan tagihan PO yang seharusnya memakai PO_BILL.`);
    }
    const duplicateReason = warnings.length ? warnings.join(" ") : null;
    if (body.type === "PO_BILL") {
      if (!body.purchaseRecordId) return Response.json({ code: "PO_REQUIRED", message: "Tagihan PO wajib tertaut ke Purchase Order." }, { status: 422 });
      const [po] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, body.purchaseRecordId)).limit(1);
      if (!po || !projectIds.includes(po.projectId)) return Response.json({ code: "PO_MISMATCH", message: "PO tidak sesuai dengan proyek pada baris biaya." }, { status: 422 });
      const previous = await db.select().from(expenseLines).innerJoin(expenses, eq(expenses.id, expenseLines.expenseId)).where(and(eq(expenses.purchaseRecordId, po.id), eq(expenses.approvalStatus, "APPROVED")));
      const billed = previous.reduce((sum, row) => sum.plus(row.expense_lines.lineTotal), D(0));
      if (billed.plus(dpp).gt(po.dppAmount) && (!body.overBillReason || body.overBillReason.trim().length < 5)) return Response.json({ code: "PO_OVERBILL_REASON_REQUIRED", message: "Akumulasi tagihan melebihi nilai PO. Alasan wajib diisi.", details: { poAmount: po.dppAmount, billed: money(billed), newBill: money(dpp) } }, { status: 422 });
    }
    const id = newId(); const year = new Date().getFullYear();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771201)`);
      const [row] = await tx.select({ value: count() }).from(expenses);
      const code = `EXP-${year}-${String(Number(row.value) + 1).padStart(6, "0")}`;
      await tx.insert(expenses).values({
        id, code, type: body.type, defaultScope: body.defaultScope, defaultProjectId: body.defaultProjectId,
        isSplit: new Set(rawLines.map((l) => `${l.scope}:${l.projectId ?? "none"}`)).size > 1, isPreBaseline,
        purchaseRecordId: body.purchaseRecordId, merchantName: body.merchantName, receiptNumber: body.receiptNumber || null,
        transactionDate: body.transactionDate, originalCurrency: body.originalCurrency, originalAmount: body.originalAmount || money(receiptTotal.div(rate)),
        exchangeRate: body.exchangeRate, subtotal: money(subtotal), discountAmount: money(headerDiscount), dppAmount: money(dpp), ppnAmount: money(ppn),
        totalAmount: money(receiptTotal), mismatchReason: body.mismatchReason, duplicateReason, paymentMethod: body.paymentMethod,
        paidByType: body.paidByType, paidByUserId: body.paidByType === "EMPLOYEE" ? body.paidByUserId : null,
        settlementStatus: body.paidByType === "EMPLOYEE" ? "PENDING" : "NOT_APPLICABLE", ocrStatus: body.receiptFileId ? "QUEUED" : "NONE",
        receiptFileId: body.receiptFileId, note: [body.note, body.overBillReason ? `Alasan kelebihan tagihan PO: ${body.overBillReason}` : null].filter(Boolean).join("\n"),
        clientUuid: body.clientUuid, createdById: user.id,
      });
      await tx.insert(expenseLines).values(rawLines.map((line, index) => ({ id: newId(), expenseId: id, scope: line.scope, projectId: line.projectId, costCategoryId: line.costCategoryId, budgetLineId: line.budgetLineId, description: line.description, quantity: line.quantity, unitCode: line.unitCode, unitPrice: money(D(line.unitPrice).times(rate)), discountAmount: money(D(line.discountAmount).times(rate)), lineTotal: money(finalTotals[index]), sortOrder: index })));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "EXPENSE", objectId: id, projectId: projectIds[0], action: "CREATED", changes: [{ field: "dppAmount", old: null, new: money(dpp) }, { field: "approvalStatus", old: null, new: "DRAFT" }], reason: duplicateReason });
      return { id, code };
    });
    return Response.json({ data: { ...result, duplicateReason, isPreBaseline } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
