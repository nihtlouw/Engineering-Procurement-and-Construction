import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import {
  activityLogs, budgetLines, budgetVersions, contractTerms, customerInvoices, expenseLines,
  expenses, poItems, projects, purchaseRecords,
} from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import type { SessionUser } from "@/lib/domain";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";
import { enforcePagu } from "@/modules/budgeting/service";
import { lineTotal } from "@/modules/budgeting/pagu";
import type { NormalizedPoItem, PoItemInput, ReceiveItemInput, TermLimitEvaluation } from "@/modules/procurement/types";

/* Semua fungsi berjalan DI DALAM withCompany(): `db` = transaksi berskope
 * company + permissions, jadi tidak ada transaksi bertingkat. */

async function log(input: {
  actorId: string; objectType: string; objectId: string; projectId: string; action: string;
  changes?: { field: string; old: unknown; new: unknown }[]; reason?: string | null;
}) {
  await db.insert(activityLogs).values({
    id: newId(), actorId: input.actorId, objectType: input.objectType, objectId: input.objectId,
    projectId: input.projectId, action: input.action, changes: input.changes ?? null, reason: input.reason ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* PO items                                                                    */
/* -------------------------------------------------------------------------- */

export async function normalizePoItems(
  user: SessionUser, projectId: string, items: PoItemInput[], overBudgetReason?: string,
): Promise<NormalizedPoItem[]> {
  const ids = [...new Set(items.map((i) => i.budgetLineId).filter((v): v is string => !!v))];
  if (ids.length) {
    const rows = await db.select({ line: budgetLines, version: budgetVersions })
      .from(budgetLines).innerJoin(budgetVersions, eq(budgetVersions.id, budgetLines.budgetVersionId))
      .where(inArray(budgetLines.id, ids));
    const map = new Map(rows.map((r) => [r.line.id, r]));
    for (const item of items) {
      if (!item.budgetLineId) continue;
      const row = map.get(item.budgetLineId);
      if (!row || row.version.projectId !== projectId || row.line.lineStatus !== "ACTIVE") {
        throw new ApiError("PO_ITEM_BUDGET_SCOPE", "Pos RAB pada PO bukan pos baseline aktif proyek ini.", 422);
      }
    }
  }
  // Pagu dihitung per pos (S2a), bukan hanya total PO.
  for (const item of items) {
    if (!item.budgetLineId) continue;
    await enforcePagu(user, {
      projectId, budgetLineId: item.budgetLineId,
      amount: D(lineTotal(item.quantity, item.unitAmount)), reason: overBudgetReason,
    });
  }
  return items.map((item, index) => ({
    ...item,
    dppAmount: lineTotal(item.quantity, item.unitAmount),
    sortOrder: item.sortOrder ?? index,
  }));
}

export async function insertPoItems(poId: string, items: NormalizedPoItem[]) {
  await db.insert(poItems).values(items.map((item) => ({
    id: newId(), purchaseRecordId: poId, budgetLineId: item.budgetLineId ?? null,
    description: item.description, quantity: D(item.quantity).toDecimalPlaces(4).toFixed(4),
    unitCode: item.unitCode, unitAmount: money(item.unitAmount), dppAmount: item.dppAmount,
    receivedQty: "0", sortOrder: item.sortOrder,
  })));
}

export async function receivePurchase(user: SessionUser, poId: string, inputs: ReceiveItemInput[]) {
  const [po] = await db.select().from(purchaseRecords).where(eq(purchaseRecords.id, poId)).limit(1);
  if (!po) throw new ApiError("NOT_FOUND", "PO tidak ditemukan.", 404);
  await requireProject(user, po.projectId, "purchase.edit");
  if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)) {
    throw new ApiError("INVALID_TRANSITION", "Penerimaan hanya untuk PO berstatus Dipesan / Diterima Sebagian.", 409);
  }
  const existing = await db.select().from(poItems).where(eq(poItems.purchaseRecordId, poId));
  const byId = new Map(existing.map((i) => [i.id, i]));
  const targets = new Map<string, Decimal>();
  for (const input of inputs) {
    const item = byId.get(input.itemId);
    if (!item) throw new ApiError("PO_ITEM_NOT_FOUND", "Pos PO tidak ditemukan.", 422);
    const qty = D(input.receivedQty);
    if (qty.lt(item.receivedQty) || qty.gt(item.quantity)) {
      throw new ApiError("RECEIVE_QTY_INVALID", `Qty diterima harus antara ${item.receivedQty} dan ${item.quantity}.`, 422);
    }
    targets.set(input.itemId, qty);
  }
  for (const [itemId, qty] of targets) {
    await db.update(poItems).set({ receivedQty: qty.toDecimalPlaces(4).toFixed(4) }).where(eq(poItems.id, itemId));
  }
  const allFull = existing.every((item) => (targets.get(item.id) ?? D(item.receivedQty)).gte(D(item.quantity)));
  const next = allFull ? "RECEIVED" : "PARTIALLY_RECEIVED";
  await db.update(purchaseRecords).set({ status: next, receivedAt: new Date() }).where(eq(purchaseRecords.id, poId));
  await log({
    actorId: user.id, objectType: "PURCHASE", objectId: poId, projectId: po.projectId, action: "ITEMS_RECEIVED",
    changes: [{ field: "status", old: po.status, new: next },
      { field: "items", old: existing.map((i) => ({ id: i.id, receivedQty: i.receivedQty })),
        new: [...targets].map(([id, qty]) => ({ id, receivedQty: qty.toFixed(4) })) }],
  });
  return { id: poId, status: next };
}

export async function enforcePoBillItems(
  poId: string, lines: { poItemId?: string | null; budgetLineId?: string | null; lineTotal: Decimal }[],
) {
  const items = await db.select().from(poItems).where(eq(poItems.purchaseRecordId, poId));
  const byId = new Map(items.map((i) => [i.id, i]));
  // PO baru wajib ditagihkan per pos. PO lama tetap punya satu pos hasil backfill.
  if (items.length && lines.some((l) => !l.poItemId)) {
    throw new ApiError("PO_ITEM_REQUIRED", "Setiap baris tagihan PO wajib memilih pos PO.", 422);
  }
  const approved = await db.select({ poItemId: expenseLines.poItemId, lineTotal: expenseLines.lineTotal })
    .from(expenseLines).innerJoin(expenses, eq(expenses.id, expenseLines.expenseId))
    .where(and(eq(expenses.purchaseRecordId, poId), eq(expenses.approvalStatus, "APPROVED")));
  const incomingByItem = new Map<string, Decimal>();
  for (const line of lines) {
    if (!line.poItemId) continue;
    incomingByItem.set(line.poItemId, (incomingByItem.get(line.poItemId) ?? D(0)).plus(line.lineTotal));
  }
  for (const [itemId, incoming] of incomingByItem) {
    const item = byId.get(itemId);
    if (!item) throw new ApiError("PO_ITEM_NOT_FOUND", "Pos PO pada tagihan tidak ditemukan.", 422);
    const related = lines.filter((l) => l.poItemId === itemId);
    if (related.some((l) => l.budgetLineId && item.budgetLineId && l.budgetLineId !== item.budgetLineId)) {
      throw new ApiError("PO_ITEM_BUDGET_MISMATCH", "Pos RAB tagihan tidak sama dengan pos PO.", 422);
    }
    const receivedValue = D(item.receivedQty).times(item.unitAmount);
    if (receivedValue.lte(0)) {
      throw new ApiError("PO_ITEM_NOT_RECEIVED", "Pos PO belum menerima barang, tidak boleh ditagihkan.", 422);
    }
    const billed = approved.filter((a) => a.poItemId === itemId)
      .reduce((sum, a) => sum.plus(a.lineTotal), D(0));
    if (billed.plus(incoming).gt(receivedValue)) {
      throw new ApiError("PO_ITEM_OVERBILL", "Tagihan melebihi nilai barang yang sudah diterima pada pos ini.", 422,
        { poItemId: itemId, receivedValue: money(receivedValue), billed: money(billed), newBill: money(incoming) });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Termin & pagu kontrak (audit B5)                                           */
/* -------------------------------------------------------------------------- */

/** Murni, tanpa DB — dipakai service dan unit test. */
export function evaluateTermLimit(input: {
  termAmount: string; termUsed: string; incoming: string;
  contractValue: string; projectUsed: string;
  reason?: string; canApprove?: boolean;
}): TermLimitEvaluation {
  const termAmount = D(input.termAmount);
  const termUsed = D(input.termUsed);
  const incoming = D(input.incoming);
  const contractValue = D(input.contractValue);
  const projectUsed = D(input.projectUsed);
  const termAfter = termUsed.plus(incoming);
  const projectAfter = projectUsed.plus(incoming);
  const overTerm = termAfter.gt(termAmount);
  const overContract = projectAfter.gt(contractValue);
  const reason = (input.reason ?? "").trim();
  const approved = reason.length >= 5 && !!input.canApprove;
  return {
    termAmount: money(termAmount), termUsed: money(termUsed), termAfter: money(termAfter),
    contractValue: money(contractValue), projectUsed: money(projectUsed), projectAfter: money(projectAfter),
    overTerm, overContract, blocked: (overTerm || overContract) && !approved,
  };
}

export async function enforceTermLimit(user: SessionUser, input: {
  projectId: string; contractTermId: string | null; incoming: string; reason?: string;
}): Promise<{ warning: string | null }> {
  const [project] = await db.select({ contractValueCurrent: projects.contractValueCurrent })
    .from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  const invoices = await db.select({
    id: customerInvoices.id, contractTermId: customerInvoices.contractTermId,
    totalAmount: customerInvoices.totalAmount, status: customerInvoices.status,
  }).from(customerInvoices).where(eq(customerInvoices.projectId, input.projectId));
  const active = invoices.filter((i) => i.status !== "CANCELLED");
  const projectUsed = active.reduce((s, i) => s.plus(i.totalAmount), D(0));
  // Tanpa termin, pagutermin = pagu kontrak agar invoice "OTHER" tidak salah diblokir.
  const termUsed = input.contractTermId
    ? active.filter((i) => i.contractTermId === input.contractTermId).reduce((s, i) => s.plus(i.totalAmount), D(0))
    : projectUsed;
  let termAmount = D(project.contractValueCurrent);
  if (input.contractTermId) {
    const [term] = await db.select({ amount: contractTerms.amount })
      .from(contractTerms).where(eq(contractTerms.id, input.contractTermId)).limit(1);
    if (!term) throw new ApiError("TERM_MISMATCH", "Termin tidak ditemukan.", 422);
    termAmount = D(term.amount);
  }
  const evaluation = evaluateTermLimit({
    termAmount: money(termAmount), termUsed: money(termUsed), incoming: input.incoming,
    contractValue: project.contractValueCurrent, projectUsed: money(projectUsed),
    reason: input.reason, canApprove: hasPermission(user, "invoice.approve"),
  });
  const reason = (input.reason ?? "").trim();
  if (evaluation.blocked) {
    if (reason.length < 5) {
      throw new ApiError("INVOICE_LIMIT_EXCEEDED",
        `Tagihan melebihi pagu ${evaluation.overTerm ? "termin" : "kontrak"}. Isi alasan over-invoice minimal 5 karakter.`,
        422, evaluation);
    }
    throw new ApiError("INVOICE_APPROVAL_REQUIRED", "Over-invoice hanya dapat diloloskan peran dengan izin invoice.approve.", 403, evaluation);
  }
  if (evaluation.overTerm || evaluation.overContract) {
    await log({
      actorId: user.id, objectType: "INVOICE", objectId: input.contractTermId ?? input.projectId,
      projectId: input.projectId, action: "OVER_INVOICE_APPROVED", reason,
      changes: [{ field: "pagu", old: evaluation.termAmount, new: evaluation.termAfter }],
    });
    return { warning: `Over-invoice disetujui: ${reason}` };
  }
  return { warning: null };
}
