import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, fileObjects } from "@/db/schema";
import { errorResponse, requireUser } from "@/lib/auth";
import { newId } from "@/lib/server-services";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"]);
const schema = z.object({ fileName: z.string().min(1).max(180), mimeType: z.string(), contentBase64: z.string().min(1) });
export async function POST(request: Request) {
  try {
    const user = await requireUser(); const body = schema.parse(await request.json());
    if (!allowed.has(body.mimeType)) return Response.json({ code: "MIME_NOT_ALLOWED", message: "Tipe file tidak diizinkan. Gunakan JPG, PNG, WebP, HEIC, PDF, XLSX, DOCX, atau DWG." }, { status: 415 });
    const buffer = Buffer.from(body.contentBase64, "base64");
    if (buffer.length > 25 * 1024 * 1024) return Response.json({ code: "FILE_TOO_LARGE", message: "Ukuran file maksimal 25 MB." }, { status: 413 });
    if (!buffer.length) return Response.json({ code: "EMPTY_FILE", message: "File kosong tidak dapat diunggah." }, { status: 422 });
    const sha256 = createHash("sha256").update(buffer).digest("hex"); const id = newId();
    const sameHash = await db.select({ id: fileObjects.id }).from(fileObjects).where(eq(fileObjects.sha256, sha256)).limit(1);
    await db.insert(fileObjects).values({ id, storageKey: `private/${user.id}/${id}-${body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`, fileName: body.fileName, mimeType: body.mimeType, sizeBytes: buffer.length, sha256, contentBase64: body.contentBase64, uploadedById: user.id });
    let duplicateReceipt = false;
    if (sameHash.length) {
      const linked = await db.select({ id: expenses.id }).from(expenses).where(andReceiptNotVoided(sameHash[0].id)).limit(1);
      duplicateReceipt = linked.length > 0;
    }
    return Response.json({ data: { id, fileName: body.fileName, sizeBytes: buffer.length, sha256, duplicateReceipt } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

function andReceiptNotVoided(fileId: string) {
  return and(ne(expenses.approvalStatus, "VOIDED"), eq(expenses.receiptFileId, fileId));
}
