import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, budgetLines, budgetVersions, changeOrders, documents, expenseLines, expenses, handoverItems, projects, punchItems, scheduleItems } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { STAGES } from "@/lib/domain";
import { buildCloseCheck } from "@/lib/finance";
import { D, todayJakarta } from "@/lib/format";
import { newId, requireProject, requiredReason } from "@/lib/server-services";

const schema = z.object({ action: z.enum(["STAGE", "SET_BASELINE", "IMPLEMENT_CHANGE_ORDER", "TOGGLE_HANDOVER", "TOGGLE_PUNCH", "ADD_PUNCH"]), targetId: z.string().optional(), value: z.string().optional(), description: z.string().optional(), reason: z.string().optional() });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id: projectId } = await params; const body = schema.parse(await request.json());
    const isCorrection = user.role === "ADMIN" && !!body.reason;
    const project = await requireProject(user, projectId, undefined, isCorrection || body.action === "STAGE");
    if (body.action === "STAGE") {
      if (project.isLocked && user.role !== "ADMIN") throw new ApiError("PROJECT_LOCKED", "Hanya koreksi admin beralasan yang dapat membuka proyek COMPLETED.", 409);
      if (project.isLocked) requiredReason(body.reason, "Alasan koreksi admin");
      const to = body.value || ""; const fromIndex = STAGES.indexOf(project.stage as (typeof STAGES)[number]); const toIndex = STAGES.indexOf(to as (typeof STAGES)[number]);
      if (toIndex < 0 || Math.abs(toIndex - fromIndex) !== 1) throw new ApiError("INVALID_STAGE_TRANSITION", "Tahap proyek hanya dapat maju atau mundur satu langkah berurutan.", 409);
      if (toIndex < fromIndex) { if (!["ADMIN", "PM"].includes(user.role)) throw new ApiError("FORBIDDEN", "Mundur tahap hanya untuk ADMIN/PM.", 403); requiredReason(body.reason, "Alasan mundur tahap"); }
      if (to === "COMPLETED") assertPermission(user, "project.close"); else assertPermission(user, "schedule.edit");
      const override = user.role === "ADMIN" && body.reason;
      if (to === "PLANNING" && !project.pmId && !override) throw new ApiError("STAGE_GATE_PM", "Tetapkan PM sebelum masuk tahap perencanaan.", 422);
      if (to === "IN_PROGRESS" && !project.startDate && !override) throw new ApiError("STAGE_GATE_START", "Tanggal mulai wajib diisi.", 422);
      if (to === "HANDOVER") {
        const milestones = await db.select().from(scheduleItems).where(and(eq(scheduleItems.projectId, projectId), eq(scheduleItems.type, "MILESTONE")));
        const open = milestones.filter((m) => m.status !== "DONE"); if (open.length && !override) throw new ApiError("STAGE_GATE_MILESTONES", `${open.length} milestone utama belum selesai.`, 422);
      }
      if (to === "WARRANTY_PERIOD") {
        const bast = await db.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.templateCode, "BAST1"), eq(documents.status, "FINAL"))).limit(1);
        if ((!project.bast1Date || !bast.length) && !override) throw new ApiError("STAGE_GATE_BAST1", "Tanggal BAST 1 dan dokumen BAST 1 FINAL wajib tersedia.", 422);
      }
      if (to === "CLOSING") {
        const warrantyEnd = project.bast1Date ? new Date(`${project.bast1Date}T12:00:00+07:00`) : null;
        if (warrantyEnd) warrantyEnd.setMonth(warrantyEnd.getMonth() + project.warrantyMonths);
        if (!project.bast2Date && (!warrantyEnd || warrantyEnd.toISOString().slice(0, 10) > todayJakarta()) && !override) throw new ApiError("STAGE_GATE_WARRANTY", "Masa garansi belum berakhir dan BAST 2 belum tercatat.", 422);
      }
      if (to === "COMPLETED" && !override) {
        const allExpenses = await db.select().from(expenses); const lines = await db.select().from(expenseLines);
        const expenseData = allExpenses.map((e) => ({ ...e, lines: lines.filter((l) => l.expenseId === e.id) }));
        const { customerInvoices, customerPayments } = await import("@/db/schema");
        const invoiceRows = await db.select().from(customerInvoices); const paymentRows = await db.select().from(customerPayments);
        const checks = buildCloseCheck({ projectId, expenses: expenseData, invoices: invoiceRows.map((i) => ({ ...i, payments: paymentRows.filter((p) => p.invoiceId === i.id) })), punchItems: await db.select().from(punchItems).where(eq(punchItems.projectId, projectId)), handoverItems: await db.select().from(handoverItems).where(eq(handoverItems.projectId, projectId)) });
        const failed = checks.filter((c) => !c.ok); if (failed.length) throw new ApiError("CLOSE_CHECK_FAILED", "Syarat penutupan belum terpenuhi.", 422, { checks });
      }
      if (to === "COMPLETED" && override) requiredReason(body.reason, "Alasan override penutupan");
      await db.transaction(async (tx) => {
        await tx.update(projects).set({ stage: to, isLocked: to === "COMPLETED" ? true : project.stage === "COMPLETED" ? false : project.isLocked, updatedAt: new Date() }).where(eq(projects.id, projectId));
        await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PROJECT", objectId: projectId, projectId, action: override ? "ADMIN_STAGE_OVERRIDE" : "STAGE_CHANGED", changes: [{ field: "stage", old: project.stage, new: to }, { field: "isLocked", old: project.isLocked, new: to === "COMPLETED" }], reason: body.reason });
      });
      return Response.json({ data: { stage: to } });
    }
    if (body.action === "SET_BASELINE") {
      assertPermission(user, "budget.approve"); await requireProject(user, projectId, "budget.approve");
      const [budget] = await db.select().from(budgetVersions).where(eq(budgetVersions.id, body.targetId || "")).limit(1);
      if (!budget || budget.projectId !== projectId) throw new ApiError("NOT_FOUND", "Versi anggaran tidak ditemukan.", 404);
      if (budget.status !== "APPROVED") throw new ApiError("BUDGET_NOT_APPROVED", "Hanya RAB berstatus APPROVED yang dapat menjadi baseline.", 409);
      const [old] = await db.select().from(budgetVersions).where(and(eq(budgetVersions.projectId, projectId), eq(budgetVersions.type, budget.type), eq(budgetVersions.isActiveBaseline, true))).limit(1);
      await db.transaction(async (tx) => {
        if (old) await tx.update(budgetVersions).set({ isActiveBaseline: false, status: "SUPERSEDED" }).where(eq(budgetVersions.id, old.id));
        await tx.update(budgetVersions).set({ isActiveBaseline: true, status: "BASELINE" }).where(eq(budgetVersions.id, budget.id));
        await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "BUDGET_VERSION", objectId: budget.id, projectId, action: "BASELINE_SET", changes: [{ field: "isActiveBaseline", old: old?.id ?? null, new: budget.id }] });
      });
      return Response.json({ data: { baselineId: budget.id } });
    }
    if (body.action === "IMPLEMENT_CHANGE_ORDER") {
      assertPermission(user, "changeorder.approve"); await requireProject(user, projectId, "changeorder.approve");
      const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, body.targetId || "")).limit(1);
      if (!co || co.projectId !== projectId) throw new ApiError("NOT_FOUND", "Change order tidak ditemukan.", 404);
      if (co.status !== "APPROVED") throw new ApiError("CO_NOT_APPROVED", "Change order harus APPROVED sebelum diimplementasikan.", 409);
      const active = await db.select().from(budgetVersions).where(and(eq(budgetVersions.projectId, projectId), eq(budgetVersions.isActiveBaseline, true)));
      const created: string[] = [];
      await db.transaction(async (tx) => {
        for (const baseline of active) {
          const impact = baseline.type === "INTERNAL" ? D(co.costImpact) : D(co.priceImpact);
          const versionNo = baseline.versionNo + 1; const newBudgetId = newId();
          await tx.update(budgetVersions).set({ isActiveBaseline: false, status: "SUPERSEDED" }).where(eq(budgetVersions.id, baseline.id));
          await tx.insert(budgetVersions).values({ id: newBudgetId, projectId, type: baseline.type, versionNo, status: "APPROVED", isActiveBaseline: false, changeOrderId: co.id, total: D(baseline.total).plus(impact).toFixed(2), approvedById: user.id, approvedAt: new Date(), createdById: user.id });
          const oldLines = await tx.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, baseline.id));
          if (oldLines.length) await tx.insert(budgetLines).values(oldLines.map((l) => ({ ...l, id: newId(), budgetVersionId: newBudgetId })));
          if (!impact.isZero()) {
            const category = baseline.type === "INTERNAL" ? "cat-civ" : "cat-civ";
            await tx.insert(budgetLines).values({ id: newId(), budgetVersionId: newBudgetId, costCategoryId: category, code: `CO-${co.code}`, description: co.scopeDescription, quantity: "1", unitCode: "Ls", unitAmount: impact.toFixed(2), total: impact.toFixed(2), sortOrder: oldLines.length + 1 });
          }
          await tx.update(budgetVersions).set({ status: "BASELINE", isActiveBaseline: true }).where(eq(budgetVersions.id, newBudgetId)); created.push(newBudgetId);
        }
        const newDate = project.targetEndDate ? new Date(`${project.targetEndDate}T12:00:00+07:00`) : null;
        if (newDate) newDate.setDate(newDate.getDate() + co.timeImpactDays);
        await tx.update(changeOrders).set({ status: "IMPLEMENTED" }).where(eq(changeOrders.id, co.id));
        await tx.update(projects).set({ targetEndDate: newDate?.toISOString().slice(0, 10) ?? project.targetEndDate, updatedAt: new Date() }).where(eq(projects.id, projectId));
        await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "CHANGE_ORDER", objectId: co.id, projectId, action: "IMPLEMENTED", changes: [{ field: "status", old: co.status, new: "IMPLEMENTED" }, { field: "baselineIds", old: active.map((b) => b.id), new: created }, { field: "targetEndDate", old: project.targetEndDate, new: newDate?.toISOString().slice(0, 10) }] });
      });
      return Response.json({ data: { id: co.id, status: "IMPLEMENTED", budgetIds: created } });
    }
    if (body.action === "TOGGLE_HANDOVER") {
      assertPermission(user, "document.upload"); const [item] = await db.select().from(handoverItems).where(eq(handoverItems.id, body.targetId || "")).limit(1);
      if (!item || item.projectId !== projectId) throw new ApiError("NOT_FOUND", "Item checklist tidak ditemukan.", 404);
      await db.update(handoverItems).set({ isDone: !item.isDone }).where(eq(handoverItems.id, item.id));
      await db.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "HANDOVER_ITEM", objectId: item.id, projectId, action: "CHECKLIST_TOGGLED", changes: [{ field: "isDone", old: item.isDone, new: !item.isDone }] });
      return Response.json({ data: { isDone: !item.isDone } });
    }
    if (body.action === "ADD_PUNCH") {
      assertPermission(user, "progress.create"); const description = requiredReason(body.description, "Uraian punch list"); const punchId = newId();
      await db.insert(punchItems).values({ id: punchId, projectId, description });
      await db.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PUNCH_ITEM", objectId: punchId, projectId, action: "CREATED", changes: [{ field: "description", old: null, new: description }] });
      return Response.json({ data: { id: punchId } }, { status: 201 });
    }
    assertPermission(user, "progress.create"); const [item] = await db.select().from(punchItems).where(eq(punchItems.id, body.targetId || "")).limit(1);
    if (!item || item.projectId !== projectId) throw new ApiError("NOT_FOUND", "Punch item tidak ditemukan.", 404);
    await db.update(punchItems).set({ isClosed: !item.isClosed, closedAt: !item.isClosed ? new Date() : null }).where(eq(punchItems.id, item.id));
    await db.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "PUNCH_ITEM", objectId: item.id, projectId, action: "STATUS_TOGGLED", changes: [{ field: "isClosed", old: item.isClosed, new: !item.isClosed }] });
    return Response.json({ data: { isClosed: !item.isClosed } });
  } catch (error) { return errorResponse(error); }
}
