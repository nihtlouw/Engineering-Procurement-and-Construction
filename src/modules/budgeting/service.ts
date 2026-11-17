import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db";
import {
  activityLogs, budgetLines, budgetVersions, contractTerms, costCategories, customerInvoices,
  expenseLines, expenses, projects, purchaseRecords, units, variationOrderLines, variationOrders,
} from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import type { SessionUser } from "@/lib/domain";
import { D, money } from "@/lib/format";
import { newId, requireProject, requiredReason } from "@/lib/server-services";
import { evaluatePagu, lineTotal } from "@/modules/budgeting/pagu";
import { BUDGET_TRANSITIONS, VARIATION_TRANSITIONS } from "@/modules/budgeting/types";
import type {
  BudgetActionInput, CreateBudgetInput, CreateVariationInput, UpdateBudgetInput, VariationActionInput,
} from "@/modules/budgeting/validation";

/* Semua fungsi di modul ini berjalan DI DALAM withCompany(): `db` sudah
 * menunjuk ke transaksi berskope company (SET LOCAL), jadi tidak ada transaksi
 * bertingkat. Satu request = satu transaksi = atomic + RLS fail-closed. */

function assertBudgetType(user: SessionUser, type: string) {
  if (!hasPermission(user, "budget.edit")) throw new ApiError("FORBIDDEN", "Izin budget.edit diperlukan.", 403);
  // Keputusan #7: RAB INTERNAL hanya ADMIN / PM / FINANCE.
  if (type === "INTERNAL" && !hasPermission(user, "budget.internal.view")) {
    throw new ApiError("FORBIDDEN", "RAB internal hanya untuk Admin, PM, dan Finance.", 403);
  }
}

async function log(input: {
  actorId: string; objectType: string; objectId: string; projectId: string; action: string;
  changes?: { field: string; old: unknown; new: unknown }[]; reason?: string | null;
}) {
  await db.insert(activityLogs).values({
    id: newId(), actorId: input.actorId, objectType: input.objectType, objectId: input.objectId,
    projectId: input.projectId, action: input.action, changes: input.changes ?? null, reason: input.reason ?? null,
  });
}

async function assertCategoriesAndUnits(lines: { costCategoryId: string; unitCode: string }[]) {
  const categoryIds = [...new Set(lines.map((l) => l.costCategoryId))];
  const unitCodes = [...new Set(lines.map((l) => l.unitCode))];
  const [cats, unitRows] = await Promise.all([
    db.select({ id: costCategories.id, isActive: costCategories.isActive }).from(costCategories).where(inArray(costCategories.id, categoryIds)),
    db.select({ code: units.code }).from(units).where(inArray(units.code, unitCodes)),
  ]);
  if (cats.length !== categoryIds.length || cats.some((c) => !c.isActive)) {
    throw new ApiError("INVALID_CATEGORY", "Kategori biaya tidak ditemukan atau tidak aktif.", 422);
  }
  if (unitRows.length !== unitCodes.length) throw new ApiError("INVALID_UNIT", "Satuan tidak dikenal.", 422);
}

function lineRows(input: { lines: CreateBudgetInput["lines"] }, budgetVersionId: string, sourceVariationId?: string) {
  return input.lines.map((l, index) => ({
    id: newId(), budgetVersionId, costCategoryId: l.costCategoryId, code: l.code ?? null,
    description: l.description.trim(), quantity: D(l.quantity).toDecimalPlaces(4).toFixed(4),
    unitCode: l.unitCode, unitAmount: money(l.unitAmount), total: lineTotal(l.quantity, l.unitAmount),
    contingencyPct: l.contingencyPct ?? null, wbsItemId: l.wbsItemId ?? null,
    keywords: l.keywords ?? null, sortOrder: l.sortOrder ?? index,
    lineStatus: "ACTIVE", sourceVariationId: sourceVariationId ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Versi RAB                                                                   */
/* -------------------------------------------------------------------------- */

export async function createBudgetVersion(user: SessionUser, input: CreateBudgetInput) {
  await requireProject(user, input.projectId, "budget.edit");
  assertBudgetType(user, input.type);
  await assertCategoriesAndUnits(input.lines);
  const total = input.lines.reduce((sum, l) => sum.plus(lineTotal(l.quantity, l.unitAmount)), D(0));

  await db.execute(sql`select pg_advisory_xact_lock(772001)`);
  const [max] = await db.select({ value: sql<number>`coalesce(max(${budgetVersions.versionNo}), 0)` })
    .from(budgetVersions).where(and(eq(budgetVersions.projectId, input.projectId), eq(budgetVersions.type, input.type)));
  const versionNo = Number(max?.value ?? 0) + 1;
  const id = newId();
  const rows = lineRows(input, id);
  await db.insert(budgetVersions).values({
    id, projectId: input.projectId, type: input.type, versionNo, status: "DRAFT",
    isActiveBaseline: false, total: money(total), createdById: user.id, revisionNote: input.revisionNote ?? null,
  });
  await db.insert(budgetLines).values(rows);
  await log({
    actorId: user.id, objectType: "BUDGET_VERSION", objectId: id, projectId: input.projectId, action: "CREATED",
    changes: [{ field: "type", old: null, new: input.type }, { field: "versionNo", old: null, new: versionNo }, { field: "total", old: null, new: money(total) }],
    reason: input.revisionNote ?? null,
  });
  return { id, versionNo, total: money(total), lineCount: rows.length };
}

export async function updateBudgetVersion(user: SessionUser, id: string, input: UpdateBudgetInput) {
  const [version] = await db.select().from(budgetVersions).where(eq(budgetVersions.id, id)).limit(1);
  if (!version) throw new ApiError("NOT_FOUND", "Versi RAB tidak ditemukan.", 404);
  await requireProject(user, version.projectId, "budget.edit");
  assertBudgetType(user, version.type);
  if (version.status !== "DRAFT" || version.lockedAt) {
    throw new ApiError("BUDGET_IMMUTABLE", "Hanya versi DRAFT yang belum dikunci yang dapat diubah.", 409);
  }
  await assertCategoriesAndUnits(input.lines);
  const oldLines = await db.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, id));
  const rows = lineRows(input, id);
  const total = rows.reduce((sum, l) => sum.plus(l.total), D(0));

  await db.delete(budgetLines).where(eq(budgetLines.budgetVersionId, id));
  await db.insert(budgetLines).values(rows);
  await db.update(budgetVersions).set({ total: money(total), revisionNote: input.revisionNote }).where(eq(budgetVersions.id, id));
  await log({
    actorId: user.id, objectType: "BUDGET_VERSION", objectId: id, projectId: version.projectId, action: "REVISED",
    reason: input.revisionNote,
    changes: [
      { field: "total", old: version.total, new: money(total) },
      { field: "lines", old: oldLines.map((l) => ({ code: l.code, description: l.description, total: l.total })),
        new: rows.map((l) => ({ code: l.code, description: l.description, total: l.total })) },
    ],
  });
  return { id, total: money(total), lineCount: rows.length };
}

export async function applyBudgetAction(user: SessionUser, id: string, input: BudgetActionInput) {
  const [version] = await db.select().from(budgetVersions).where(eq(budgetVersions.id, id)).limit(1);
  if (!version) throw new ApiError("NOT_FOUND", "Versi RAB tidak ditemukan.", 404);
  await requireProject(user, version.projectId);
  const next = BUDGET_TRANSITIONS[version.status]?.[input.action];
  if (!next) throw new ApiError("INVALID_TRANSITION", `Aksi ${input.action} tidak valid untuk status ${version.status}.`, 409);

  if (input.action === "SUBMIT" && !hasPermission(user, "budget.edit")) {
    throw new ApiError("FORBIDDEN", "Izin budget.edit diperlukan.", 403);
  }
  if (["APPROVE", "RETURN", "REJECT", "SET_BASELINE"].includes(input.action) && !hasPermission(user, "budget.approve")) {
    throw new ApiError("FORBIDDEN", "Izin budget.approve diperlukan.", 403);
  }
  if (["RETURN", "REJECT"].includes(input.action)) requiredReason(input.reason, "Alasan");
  if (input.action === "APPROVE" && version.createdById === user.id && user.companyRole !== "ADMIN") {
    throw new ApiError("SEPARATION_OF_DUTY", "Pembuat RAB tidak dapat menyetujui RAB yang dibuatnya sendiri.", 403);
  }
  if (input.action === "SET_BASELINE") {
    const [active] = await db.select().from(budgetVersions).where(and(
      eq(budgetVersions.projectId, version.projectId), eq(budgetVersions.type, version.type),
      eq(budgetVersions.isActiveBaseline, true))).limit(1);
    // Urutan PENTING: nonaktifkan lama dulu, baru aktifkan yang baru, agar
    // partial unique index budget_one_active_baseline_idx tidak bentrok.
    if (active) {
      await db.update(budgetVersions).set({ isActiveBaseline: false, status: "SUPERSEDED", supersededBy: id })
        .where(eq(budgetVersions.id, active.id));
    }
    await db.update(budgetVersions).set({ isActiveBaseline: true, status: next, lockedAt: new Date(), approvedById: user.id, approvedAt: new Date() })
      .where(eq(budgetVersions.id, id));
    await log({ actorId: user.id, objectType: "BUDGET_VERSION", objectId: id, projectId: version.projectId, action: "BASELINE_SET",
      changes: [{ field: "isActiveBaseline", old: active?.id ?? null, new: id }, { field: "versionNo", old: active?.versionNo ?? null, new: version.versionNo }] });
    return { id, status: next, baselineId: id };
  }

  await db.update(budgetVersions).set({ status: next, ...(next === "APPROVED" ? { approvedById: user.id, approvedAt: new Date() } : {}) })
    .where(eq(budgetVersions.id, id));
  await log({ actorId: user.id, objectType: "BUDGET_VERSION", objectId: id, projectId: version.projectId, action: input.action,
    changes: [{ field: "status", old: version.status, new: next }], reason: input.reason ?? null });
  return { id, status: next };
}

/* -------------------------------------------------------------------------- */
/* Pagu per pos (dipakai expenses & purchases)                                */
/* -------------------------------------------------------------------------- */

export async function enforcePagu(user: SessionUser, input: {
  projectId: string | null; budgetLineId: string; amount: Decimal; reason?: string;
}): Promise<{ warning: string | null }> {
  if (!input.projectId) throw new ApiError("BUDGET_LINE_SCOPE", "Pos RAB hanya boleh dipakai pada baris biaya proyek.", 422);
  const [row] = await db.select({ line: budgetLines, version: budgetVersions })
    .from(budgetLines).innerJoin(budgetVersions, eq(budgetVersions.id, budgetLines.budgetVersionId))
    .where(eq(budgetLines.id, input.budgetLineId)).limit(1);
  if (!row || row.version.projectId !== input.projectId) {
    throw new ApiError("BUDGET_LINE_SCOPE", "Pos RAB bukan milik proyek ini.", 422);
  }
  if (row.line.lineStatus === "OMITTED") throw new ApiError("BUDGET_LINE_OMITTED", "Pos RAB sudah dicoret oleh PTK.", 422);

  const [expenseRows, poRows] = await Promise.all([
    db.select({ total: expenseLines.lineTotal, status: expenses.approvalStatus })
      .from(expenseLines).innerJoin(expenses, eq(expenses.id, expenseLines.expenseId))
      .where(eq(expenseLines.budgetLineId, input.budgetLineId)),
    db.select({ dpp: purchaseRecords.dppAmount, status: purchaseRecords.status })
      .from(purchaseRecords).where(eq(purchaseRecords.budgetLineId, input.budgetLineId)),
  ]);
  const actual = expenseRows.filter((e) => e.status === "APPROVED").reduce((s, e) => s.plus(e.total), D(0));
  const pending = expenseRows.filter((e) => ["SUBMITTED", "NEEDS_CORRECTION"].includes(e.status)).reduce((s, e) => s.plus(e.total), D(0));
  const committed = poRows.filter((p) => ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(p.status)).reduce((s, p) => s.plus(p.dpp), D(0));
  const evaluation = evaluatePagu({
    total: row.line.total, contingencyPct: row.line.contingencyPct,
    actual: money(actual), pending: money(pending), committed: money(committed), incoming: money(input.amount),
  });

  if (evaluation.blocked) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 5) {
      throw new ApiError("BUDGET_LIMIT_EXCEEDED", `${evaluation.warning} Isi alasan overbudget minimal 5 karakter.`, 422,
        { pagu: evaluation.pagu, used: evaluation.used, ratioPct: evaluation.ratioPct });
    }
    if (!hasPermission(user, "budget.approve")) {
      throw new ApiError("BUDGET_APPROVAL_REQUIRED", "Overbudget hanya dapat diloloskan peran dengan izin budget.approve.", 403);
    }
    await log({ actorId: user.id, objectType: "BUDGET_LINE", objectId: input.budgetLineId, projectId: input.projectId,
      action: "OVERBUDGET_APPROVED", reason, changes: [{ field: "pagu", old: evaluation.pagu, new: evaluation.used }] });
    return { warning: `Overbudget disetujui (${evaluation.ratioPct.toFixed(0)}%): ${reason}` };
  }
  return { warning: evaluation.warning };
}

/* -------------------------------------------------------------------------- */
/* PTK / Variation Order                                                      */
/* -------------------------------------------------------------------------- */

export async function createVariation(user: SessionUser, input: CreateVariationInput) {
  await requireProject(user, input.projectId, "variation.edit");
  if (!hasPermission(user, "budget.internal.view") && new Decimal(input.costImpact).abs().gt(0)) {
    throw new ApiError("FORBIDDEN", "Dampak biaya internal hanya boleh diisi Admin/PM/Finance.", 403);
  }
  await db.execute(sql`select pg_advisory_xact_lock(772003)`);
  const [countRow] = await db.select({ value: sql<number>`count(*)` }).from(variationOrders);
  const code = `PTK-${new Date().getFullYear()}-${String(Number(countRow?.value ?? 0) + 1).padStart(3, "0")}`;
  const id = newId();
  await db.insert(variationOrders).values({
    id, projectId: input.projectId, code, variationType: input.variationType, title: input.title,
    reason: input.reason, scopeDescription: input.scopeDescription, priceImpact: money(input.priceImpact),
    costImpact: money(input.costImpact), timeImpactDays: input.timeImpactDays, status: "DRAFT",
    clientReference: input.clientReference ?? null, evidenceFileId: input.evidenceFileId ?? null,
    createdById: user.id,
  });
  await db.insert(variationOrderLines).values(input.lines.map((l, i) => ({
    id: newId(), variationOrderId: id, action: l.action, budgetType: l.budgetType,
    budgetLineId: l.budgetLineId ?? null, description: l.description, quantity: D(l.quantity).toDecimalPlaces(4).toFixed(4),
    unitCode: l.unitCode, unitAmount: money(l.unitAmount), priceAmount: money(l.priceAmount),
    costAmount: money(l.costAmount), sortOrder: l.sortOrder ?? i,
  })));
  await log({ actorId: user.id, objectType: "VARIATION_ORDER", objectId: id, projectId: input.projectId, action: "CREATED",
    changes: [{ field: "variationType", old: null, new: input.variationType }, { field: "priceImpact", old: null, new: money(input.priceImpact) },
      { field: "timeImpactDays", old: null, new: input.timeImpactDays }] });
  return { id, code };
}

export async function applyVariationAction(user: SessionUser, id: string, input: VariationActionInput) {
  const [vo] = await db.select().from(variationOrders).where(eq(variationOrders.id, id)).limit(1);
  if (!vo) throw new ApiError("NOT_FOUND", "PTK tidak ditemukan.", 404);
  await requireProject(user, vo.projectId);
  const next = VARIATION_TRANSITIONS[vo.status]?.[input.action];
  if (!next) throw new ApiError("INVALID_TRANSITION", `Aksi ${input.action} tidak valid untuk status ${vo.status}.`, 409);
  const approverActions = ["APPROVE", "REJECT", "CANCEL", "IMPLEMENT"];
  if (approverActions.includes(input.action) && !hasPermission(user, "variation.approve")) {
    throw new ApiError("FORBIDDEN", "Izin variation.approve diperlukan.", 403);
  }
  if (!approverActions.includes(input.action) && !hasPermission(user, "variation.edit")) {
    throw new ApiError("FORBIDDEN", "Izin variation.edit diperlukan.", 403);
  }
  if (["REJECT", "CANCEL"].includes(input.action)) requiredReason(input.reason, "Alasan");
  if (["APPROVE", "IMPLEMENT"].includes(input.action) && vo.createdById === user.id && user.companyRole !== "ADMIN") {
    throw new ApiError("SEPARATION_OF_DUTY", "Pembuat PTK tidak dapat memutuskan/mengimplementasikan PTK-nya sendiri.", 403);
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, vo.projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);

  if (input.action === "APPROVE") {
    const after = D(project.contractValueCurrent).plus(vo.priceImpact);
    if (after.lt(0)) throw new ApiError("CONTRACT_VALUE_NEGATIVE", "Dampak PTK membuat nilai kontrak berjalan negatif.", 422);
    await db.update(variationOrders).set({
      status: next, clientApprovedAt: new Date(), clientApprovedBy: user.id,
      clientReference: input.clientReference ?? vo.clientReference,
      contractValueBefore: money(project.contractValueCurrent), contractValueAfter: money(after), updatedAt: new Date(),
    }).where(eq(variationOrders.id, id));
    await log({ actorId: user.id, objectType: "VARIATION_ORDER", objectId: id, projectId: vo.projectId, action: "CLIENT_APPROVED",
      changes: [{ field: "status", old: vo.status, new: next }, { field: "contractValue", old: project.contractValueCurrent, new: money(after) }] });
    return { id, status: next, contractValueAfter: money(after) };
  }

  if (input.action === "IMPLEMENT") return implementVariation(user, vo, project, next);

  await db.update(variationOrders).set({
    status: next, cancelReason: input.action === "CANCEL" ? (input.reason ?? "").trim() : vo.cancelReason,
    updatedAt: new Date(),
  }).where(eq(variationOrders.id, id));
  await log({ actorId: user.id, objectType: "VARIATION_ORDER", objectId: id, projectId: vo.projectId, action: input.action,
    changes: [{ field: "status", old: vo.status, new: next }], reason: input.reason ?? null });
  return { id, status: next };
}

async function implementVariation(
  user: SessionUser,
  vo: typeof variationOrders.$inferSelect,
  project: typeof projects.$inferSelect,
  next: string,
) {
  const [fallbackCategory] = await db.select({ id: costCategories.id }).from(costCategories)
    .where(eq(costCategories.isActive, true)).limit(1);
  if (!fallbackCategory) throw new ApiError("CATEGORY_REQUIRED", "Isi katalog kategori biaya terlebih dahulu.", 422);
  const baselines = await db.select().from(budgetVersions).where(and(
    eq(budgetVersions.projectId, vo.projectId), eq(budgetVersions.isActiveBaseline, true)));
  if (!baselines.length) throw new ApiError("NO_ACTIVE_BASELINE", "Tetapkan baseline RAB sebelum mengimplementasikan PTK.", 409);
  const vLines = await db.select().from(variationOrderLines).where(eq(variationOrderLines.variationOrderId, vo.id));

  // Target OMIT/ADJUST harus benar-benar pos baseline aktif proyek ini.
  for (const vl of vLines.filter((l) => l.action !== "ADD")) {
    const [target] = await db.select({ line: budgetLines, version: budgetVersions })
      .from(budgetLines).innerJoin(budgetVersions, eq(budgetVersions.id, budgetLines.budgetVersionId))
      .where(eq(budgetLines.id, vl.budgetLineId ?? "")).limit(1);
    if (!target || !target.version.isActiveBaseline || target.version.projectId !== vo.projectId || target.version.type !== vl.budgetType) {
      throw new ApiError("VARIATION_TARGET_INVALID", `Pos ${vl.budgetLineId} bukan pos baseline aktif ${vl.budgetType} proyek ini.`, 422);
    }
  }

  // Dampak waktu BERTANDA, dengan guard tidak boleh mundur sebelum tanggal mulai.
  let targetEndDate = project.targetEndDate;
  if (vo.timeImpactDays !== 0 && project.targetEndDate) {
    const d = new Date(`${project.targetEndDate}T12:00:00+07:00`);
    d.setDate(d.getDate() + vo.timeImpactDays);
    const candidate = d.toISOString().slice(0, 10);
    if (project.startDate && candidate < project.startDate) {
      throw new ApiError("SCHEDULE_UNDERFLOW", "Dampak waktu PTK membuat target selesai lebih awal dari tanggal mulai.", 422);
    }
    targetEndDate = candidate;
  }

  const created: string[] = [];
  for (const baseline of baselines) {
    const newIdVersion = newId();
    const applicable = vLines.filter((l) => l.budgetType === baseline.type);
    const oldLines = await db.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, baseline.id));

    const rows = oldLines.map((l) => {
      const adjust = applicable.find((a) => a.action === "ADJUST" && a.budgetLineId === l.id);
      const omit = applicable.find((a) => a.action === "OMIT" && a.budgetLineId === l.id);
      const quantity = adjust ? adjust.quantity : l.quantity;
      const unitAmount = adjust ? adjust.unitAmount : l.unitAmount;
      return {
        id: newId(), budgetVersionId: newIdVersion, costCategoryId: l.costCategoryId,
        code: l.code, description: adjust?.description ?? l.description,
        quantity: D(quantity).toDecimalPlaces(4).toFixed(4), unitCode: adjust?.unitCode ?? l.unitCode,
        unitAmount: money(unitAmount), total: lineTotal(quantity, unitAmount),
        contingencyPct: l.contingencyPct, wbsItemId: l.wbsItemId, keywords: l.keywords,
        sortOrder: l.sortOrder, lineStatus: omit ? "OMITTED" : "ACTIVE",
        variationAction: omit ? "OMIT" : adjust ? "ADJUST" : null,
        sourceVariationId: omit || adjust ? vo.id : l.sourceVariationId,
      };
    });
    for (const add of applicable.filter((a) => a.action === "ADD")) {
      rows.push({
        id: newId(), budgetVersionId: newIdVersion, costCategoryId: fallbackCategory.id,
        code: `PTK-${vo.code}`, description: add.description, quantity: D(add.quantity).toDecimalPlaces(4).toFixed(4),
        unitCode: add.unitCode, unitAmount: money(add.unitAmount), total: lineTotal(add.quantity, add.unitAmount),
        contingencyPct: null, wbsItemId: null, keywords: null, sortOrder: rows.length,
        lineStatus: "ACTIVE", variationAction: "ADD", sourceVariationId: vo.id,
      });
    }
    const total = rows.filter((r) => r.lineStatus === "ACTIVE").reduce((s, r) => s.plus(r.total), D(0));

    await db.update(budgetVersions).set({ isActiveBaseline: false, status: "SUPERSEDED", supersededBy: newIdVersion })
      .where(eq(budgetVersions.id, baseline.id));
    await db.insert(budgetVersions).values({
      id: newIdVersion, projectId: vo.projectId, type: baseline.type, versionNo: baseline.versionNo + 1,
      status: "BASELINE", isActiveBaseline: true, total: money(total), createdById: user.id,
      approvedById: user.id, approvedAt: new Date(), lockedAt: new Date(),
      revisionNote: `Revisi otomatis ${vo.code}`, sourceVariationId: vo.id, createdFromVersionId: baseline.id,
    });
    await db.insert(budgetLines).values(rows);
    created.push(newIdVersion);
  }

  await db.update(projects).set({ targetEndDate, updatedAt: new Date() }).where(eq(projects.id, vo.projectId));
  await db.update(variationOrders).set({ status: next, implementedAt: new Date(), updatedAt: new Date() })
    .where(eq(variationOrders.id, vo.id));

  // Rekalkulasi termin persentase dari SATU nilai kontrak berjalan.
  const [finalProject] = await db.select().from(projects).where(eq(projects.id, vo.projectId)).limit(1);
  const [terms, invoices] = await Promise.all([
    db.select().from(contractTerms).where(eq(contractTerms.projectId, vo.projectId)),
    db.select().from(customerInvoices).where(eq(customerInvoices.projectId, vo.projectId)),
  ]);
  const skippedTerms: string[] = [];
  for (const term of terms) {
    if (!term.percent) continue;
    const newAmount = money(D(term.percent).div(100).times(finalProject.contractValueCurrent));
    const invoiced = invoices.filter((i) => i.contractTermId === term.id && i.status !== "CANCELLED")
      .reduce((s, i) => s.plus(i.totalAmount), D(0));
    if (D(newAmount).lt(invoiced)) { skippedTerms.push(term.id); continue; }
    await db.update(contractTerms).set({ amount: newAmount }).where(eq(contractTerms.id, term.id));
  }

  await log({
    actorId: user.id, objectType: "VARIATION_ORDER", objectId: vo.id, projectId: vo.projectId, action: "IMPLEMENTED",
    reason: vo.reason,
    changes: [
      { field: "status", old: vo.status, new: next },
      { field: "baselineIds", old: baselines.map((b) => b.id), new: created },
      { field: "targetEndDate", old: project.targetEndDate, new: targetEndDate },
      { field: "contractValue", old: project.contractValueCurrent, new: finalProject.contractValueCurrent },
      { field: "termsSkippedAlreadyInvoiced", old: null, new: skippedTerms },
      { field: "lines", old: null, new: vLines.map((l) => ({ action: l.action, type: l.budgetType, description: l.description, priceAmount: l.priceAmount })) },
    ],
  });
  return { id: vo.id, status: next, budgetIds: created, contractValueCurrent: finalProject.contractValueCurrent, termsSkipped: skippedTerms.length };
}
