import { companyRoute } from "@/shared/auth/route";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, expenseLines, expenses, fieldPhotos, fileObjects } from "@/db/schema";
import { ApiError, errorResponse, requireUser, signFileToken } from "@/lib/auth";
import { requireProject } from "@/lib/server-services";
import { getObjectBuffer, type StoredFile } from "@/modules/field-photos/storage";

async function GETHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const [photo] = await db.select().from(fieldPhotos).where(eq(fieldPhotos.fileId, id)).limit(1);
    if (expense) {
      const [line] = await db.select().from(expenseLines).where(eq(expenseLines.expenseId, expense.id)).limit(1);
      if (line?.projectId) await requireProject(user, line.projectId);
      else if (user.role !== "ADMIN" && user.role !== "FINANCE" && expense.createdById !== user.id) throw new ApiError("FORBIDDEN", "Anda tidak memiliki akses ke file ini.", 403);
    } else if (document?.projectId) await requireProject(user, document.projectId, "document.view", true);
    else if (photo) {
      if (user.role === "CLIENT_VIEWER" && !photo.isSelectedForReport) {
        throw new ApiError("FORBIDDEN", "Foto ini belum diproyeksikan ke laporan.", 403);
      }
      await requireProject(user, photo.projectId, "document.view", true);
    }
    else if (file.uploadedById !== user.id && user.role !== "ADMIN") throw new ApiError("FORBIDDEN", "Anda tidak memiliki akses ke file ini.", 403);
    const buffer = await getObjectBuffer(file as StoredFile);
    /* Berkas CSV/HTML/SVG yang tersaji `inline` dapat mengeksekusi skrip pada
       origin aplikasi. Tipe yang tidak dapat dirender aman dipaksa unduh, dan
       CSP ketat ditambahkan untuk semua respons berkas (defense-in-depth bila
       `nosniff` diabaikan peramban lama). */
    const inlineSafe = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    const disposition = inlineSafe.has(file.mimeType) ? "inline" : "attachment";
    return new Response(new Uint8Array(buffer), { headers: {
      "Content-Type": file.mimeType, "Content-Length": String(buffer.length),
      "Content-Disposition": `${disposition}; filename="${file.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
