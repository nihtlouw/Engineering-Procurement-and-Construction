import { companyRoute } from "@/shared/auth/route";
import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses, fileObjects } from "@/db/schema";
import { errorResponse, requireUser } from "@/lib/auth";
import { newId } from "@/lib/server-services";
import { putObject, removeObject } from "@/modules/field-photos/storage";
import { MAX_GENERIC_FILE_BYTES, validateGenericFile } from "@/modules/files/validation";

/**
 * Unggah berkas generik (nota, PDF, XLSX, DOCX).
 *
 * Audit #6 diperbaiki di sini:
 * - MIME ditentukan dari **isi** berkas (magic bytes), bukan dari klien;
 * - batas 10 MB (sebelumnya 25 MB, di atas batas body Vercel);
 * - byte ditulis ke object storage, `content_base64` TIDAK diisi lagi sehingga
 *   database tidak lagi menyimpan blob;
 * - `storage_key` menyertakan company + user sehingga policy storage dapat
 *   diterapkan dan berkas tidak tercampur antar tenant.
 */
const schema = z.object({
  fileName: z.string().min(1).max(180),
  mimeType: z.string().max(160).optional(),
  contentBase64: z.string().min(1),
});

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "berkas";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json());

    // Batas panjang base64 memotong payload raksasa sebelum dialokasikan.
    if (body.contentBase64.length > Math.ceil((MAX_GENERIC_FILE_BYTES * 4) / 3) + 8) {
      return Response.json({ code: "FILE_TOO_LARGE", message: "Ukuran file maksimal 10 MB." }, { status: 413 });
    }
    const buffer = Buffer.from(body.contentBase64, "base64");
    const mimeType = validateGenericFile(buffer, body.mimeType);

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const id = newId();
    const storageKey = `private/${user.companyId}/files/${user.id}/${id}-${safeName(body.fileName)}`;
    const stored = await putObject(buffer, storageKey, mimeType);
    try {
      await db.insert(fileObjects).values({
        id, storageKey, storageProvider: stored.storageProvider, storageBucket: stored.storageBucket,
        fileName: body.fileName, mimeType, sizeBytes: buffer.length, sha256,
        contentBase64: null, uploadedById: user.id,
      });
    } catch (error) {
      // Object tanpa baris DB = orphan; kompensasi sebelum melempar error asli.
      await removeObject(storageKey, stored.storageProvider, stored.storageBucket);
      throw error;
    }

    let duplicateReceipt = false;
    const sameHash = await db.select({ id: fileObjects.id }).from(fileObjects).where(eq(fileObjects.sha256, sha256)).limit(1);
    if (sameHash.length) {
      const linked = await db.select({ id: expenses.id })
        .from(expenses)
        .where(and(ne(expenses.approvalStatus, "VOIDED"), eq(expenses.receiptFileId, sameHash[0].id)))
        .limit(1);
      duplicateReceipt = linked.length > 0;
    }
    return Response.json({
      data: { id, fileName: body.fileName, mimeType, sizeBytes: buffer.length, sha256, duplicateReceipt },
    }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
