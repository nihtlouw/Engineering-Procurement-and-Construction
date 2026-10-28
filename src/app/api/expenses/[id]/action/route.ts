import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, expenseLines, expenses, notifications, projects, users } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { EXPENSE_TRANSITIONS } from "@/lib/domain";
import { D, money } from "@/lib/format";
import { assertTransition, newId, requireProject, requiredReason } from "@/lib/server-services";

const schema = z.object({ action: z.enum(["SUBMIT", "APPROVE", "RETURN", "REJECT", "VOID"]), comment: z.string().optional(), overrideReason: z.string().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await params; const body = schema.parse(await request.json());
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    if (!expense) throw new ApiError("NOT_FOUND", "Pengeluaran tidak ditemukan.", 404);
    const lines = await db.select().from(expenseLines).where(eq(expenseLines.expenseId, id));
    const projectIds = [...new Set(lines.filter((l) => l.projectId).map((l) => l.projectId!))];
    if (projectIds[0]) await requireProject(user, projectIds[0], undefined, body.action === "VOID" && user.role === "ADMIN");
    if (body.action === "SUBMIT") {
      assertPermission(user, "expense.create");
      if (expense.createdById !== user.id && user.role !== "ADMIN") throw new ApiError("NOT_OWNER", "Hanya pembuat draft yang dapat mengirim pengeluaran ini.", 403);
    } else if (body.action === "VOID") assertPermission(user, "expense.void");
    else {
      assertPermission(user, "expense.approve");
      if (expense.assignedApproverId && expense.assignedApproverId !== user.id && user.role !== "ADMIN") throw new ApiError("NOT_ASSIGNED_APPROVER", `Pengeluaran ini ditugaskan kepada approver lain.`, 403);
    }
    const next = assertTransition(EXPENSE_TRANSITIONS, expense.approvalStatus, body.action);
    if (["RETURN", "REJECT"].includes(body.action)) requiredReason(body.comment, "Komentar");
    if (body.action === "VOID") requiredReason(body.comment, "Alasan VOID");
    if (["APPROVE", "RETURN", "REJECT"].includes(body.action) && expense.createdById === user.id) {
      if (user.role !== "ADMIN") throw new ApiError("SEPARATION_OF_DUTY", "Pembuat record tidak boleh memproses persetujuannya sendiri.", 403);
      requiredReason(body.overrideReason, "Alasan override admin");
    }
    let assignedApproverId = expense.assignedApproverId;
    if (body.action === "SUBMIT") {
      if (!lines.length || lines.some((l) => !l.costCategoryId)) throw new ApiError("INCOMPLETE_LINES", "Minimal satu baris dan kategori pada setiap baris wajib diisi.", 422);
      const lineTotal = lines.reduce((sum, l) => sum.plus(l.lineTotal), D(0));
      const expected = lineTotal.plus(expense.ppnAmount);
      if (expected.minus(expense.totalAmount).abs().gt(1) && (!expense.mismatchReason || expense.mismatchReason.length < 5)) throw new ApiError("MISMATCH_REASON_REQUIRED", `Selisih total ${money(expected.minus(expense.totalAmount).abs())} memerlukan alasan.`, 422);
      if (expense.paidByType === "EMPLOYEE" && !expense.paidByUserId) throw new ApiError("PAYEE_REQUIRED", "Karyawan pembayar wajib diisi.", 422);
      const isCrossProject = projectIds.length > 1; const hasOverhead = lines.some((l) => l.scope === "OVERHEAD");
      let approverId: string | undefined;
      if (isCrossProject || hasOverhead || expense.defaultScope === "OVERHEAD") {
        approverId = (await db.select().from(users).where(eq(users.role, "FINANCE")).limit(1))[0]?.id;
      } else {
        const [project] = await db.select().from(projects).where(eq(projects.id, projectIds[0])).limit(1);
        approverId = project?.pmId ?? undefined;
        if (approverId === expense.createdById) approverId = (await db.select().from(users).where(eq(users.role, "FINANCE")).limit(1))[0]?.id;
      }
      if (!approverId) throw new ApiError("APPROVER_NOT_FOUND", "Approver tidak tersedia. Tetapkan PM atau pengguna FINANCE.", 422);
      assignedApproverId = approverId;
      await db.insert(notifications).values({ id: newId(), userId: approverId, type: "APPROVAL", title: `${expense.code} menunggu persetujuan`, body: `${expense.merchantName} — total Rp ${money(expense.totalAmount)}`, link: "approvals" });
    }
    const override = expense.createdById === user.id && user.role === "ADMIN" && ["APPROVE", "RETURN", "REJECT"].includes(body.action);
    await db.transaction(async (tx) => {
      await tx.update(expenses).set({ approvalStatus: next, assignedApproverId, submittedAt: body.action === "SUBMIT" ? new Date() : expense.submittedAt, approvedAt: body.action === "APPROVE" ? new Date() : expense.approvedAt, voidReason: body.action === "VOID" ? body.comment : expense.voidReason, note: ["RETURN", "REJECT"].includes(body.action) ? [expense.note, `Catatan approver: ${body.comment}`].filter(Boolean).join("\n") : expense.note, updatedAt: new Date() }).where(eq(expenses.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "EXPENSE", objectId: id, projectId: projectIds[0], action: override ? "OVERRIDE" : body.action, changes: [{ field: "approvalStatus", old: expense.approvalStatus, new: next }, ...(assignedApproverId !== expense.assignedApproverId ? [{ field: "assignedApproverId", old: expense.assignedApproverId, new: assignedApproverId }] : [])], reason: body.overrideReason || body.comment });
    });
    if (["RETURN", "REJECT", "APPROVE"].includes(body.action)) await db.insert(notifications).values({ id: newId(), userId: expense.createdById, type: body.action, title: `${expense.code}: ${next}`, body: body.comment || "Status pengeluaran telah diperbarui.", link: "expenses" });
    return Response.json({ data: { id, approvalStatus: next, assignedApproverId } });
  } catch (error) { return errorResponse(error); }
}
