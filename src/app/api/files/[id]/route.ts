import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, expenseLines, expenses, fileObjects } from "@/db/schema";
import { ApiError, errorResponse, requireUser, signFileToken } from "@/lib/auth";
import { requireProject } from "@/lib/server-services";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await params; const url = new URL(request.url);
    const expires = Number(url.searchParams.get("expires")); const signature = url.searchParams.get("signature") || "";
    if (!expires || expires < Math.floor(Date.now() / 1000)) throw new ApiError("SIGNED_URL_EXPIRED", "URL file kedaluwarsa. Muat ulang halaman.", 403);
    const expected = signFileToken(id, expires); const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError("INVALID_SIGNATURE", "Tanda tangan URL file tidak valid.", 403);
    const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, id)).limit(1);
    if (!file) throw new ApiError("NOT_FOUND", "File tidak ditemukan.", 404);
    const [expense] = await db.select().from(expenses).where(eq(expenses.receiptFileId, id)).limit(1);
    const [document] = await db.select().from(documents).where(eq(documents.fileId, id)).limit(1);
    if (expense) {
      const [line] = await db.select().from(expenseLines).where(eq(expenseLines.expenseId, expense.id)).limit(1);
      if (line?.projectId) await requireProject(user, line.projectId);
      else if (user.role !== "ADMIN" && user.role !== "FINANCE" && expense.createdById !== user.id) throw new ApiError("FORBIDDEN", "Anda tidak memiliki akses ke file ini.", 403);
    } else if (document?.projectId) await requireProject(user, document.projectId, "document.view", true);
    else if (file.uploadedById !== user.id && user.role !== "ADMIN") throw new ApiError("FORBIDDEN", "Anda tidak memiliki akses ke file ini.", 403);
    return new Response(Buffer.from(file.contentBase64, "base64"), { headers: { "Content-Type": file.mimeType, "Content-Length": String(file.sizeBytes), "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
