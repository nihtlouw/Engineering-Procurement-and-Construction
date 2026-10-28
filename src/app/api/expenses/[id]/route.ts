import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, expenseLines, expenses, fileObjects } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ merchantName: z.string().min(2).optional(), receiptNumber: z.string().optional(), note: z.string().optional(), mismatchReason: z.string().optional(), receiptFileId: z.string().nullable().optional() });
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "expense.create"); const { id } = await params; const body = schema.parse(await request.json());
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1); if (!expense) throw new ApiError("NOT_FOUND", "Pengeluaran tidak ditemukan.", 404);
    if (!["DRAFT", "NEEDS_CORRECTION"].includes(expense.approvalStatus)) throw new ApiError("IMMUTABLE_RECORD", "Pengeluaran yang sudah diajukan/disetujui tidak dapat diedit langsung.", 409);
    if (expense.createdById !== user.id && user.role !== "ADMIN") throw new ApiError("NOT_OWNER", "Hanya pembuat yang dapat memperbaiki draft.", 403);
    const [line] = await db.select().from(expenseLines).where(eq(expenseLines.expenseId, id)).limit(1); if (line?.projectId) await requireProject(user, line.projectId);
    if (body.receiptFileId) { const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, body.receiptFileId)).limit(1); if (!file || file.uploadedById !== user.id) throw new ApiError("FILE_NOT_FOUND", "File koreksi tidak tersedia.", 422); }
    const changes = Object.entries(body).filter(([key, value]) => value !== undefined && value !== expense[key as keyof typeof expense]).map(([field, value]) => ({ field, old: expense[field as keyof typeof expense], new: value }));
    await db.transaction(async (tx) => {
      await tx.update(expenses).set({ ...body, updatedAt: new Date() }).where(eq(expenses.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "EXPENSE", objectId: id, projectId: line?.projectId, action: "CORRECTED", changes });
    });
    return Response.json({ data: { id, corrected: true } });
  } catch (error) { return errorResponse(error); }
}
