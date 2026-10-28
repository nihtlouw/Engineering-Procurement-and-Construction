import { createHash } from "node:crypto";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, documents, fileObjects, projects } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import type { DocumentBlock } from "@/lib/document-templates";
import { renderDocumentPdf } from "@/lib/pdf";
import { newId, requireProject } from "@/lib/server-services";

const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const schema = z.object({ action: z.enum(["FINALIZE", "REVISE"]) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await params; const { action } = schema.parse(await request.json());
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1); if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
    await requireProject(user, doc.projectId, action === "FINALIZE" ? "gendoc.finalize" : "gendoc.create");
    if (action === "REVISE") {
      if (doc.status !== "FINAL") throw new ApiError("NOT_FINAL", "Hanya dokumen FINAL yang dapat direvisi.", 409);
      const newDocId = newId();
      await db.transaction(async (tx) => {
        await tx.update(documents).set({ status: "SUPERSEDED" }).where(eq(documents.id, id));
        await tx.insert(documents).values({ id: newDocId, projectId: doc.projectId, relatedType: doc.relatedType, relatedId: doc.relatedId, category: doc.category, title: doc.title, versionNo: doc.versionNo, revisionNo: doc.revisionNo + 1, templateCode: doc.templateCode, templateVersion: doc.templateVersion, mergeSnapshot: doc.mergeSnapshot, blocks: doc.blocks, status: "DRAFT", uploadedById: user.id });
        await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: newDocId, projectId: doc.projectId, action: "REVISED", changes: [{ field: "revisionNo", old: doc.revisionNo, new: doc.revisionNo + 1 }, { field: "previousDocumentId", old: null, new: doc.id }] });
      });
      return Response.json({ data: { id: newDocId } }, { status: 201 });
    }
    if (doc.status !== "DRAFT" && doc.status !== "IN_REVIEW") throw new ApiError("DOCUMENT_LOCKED", "Dokumen FINAL tidak dapat diubah. Buat revisi baru.", 409);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771204)`); const [row] = await tx.select({ value: count() }).from(documents).where(isNotNull(documents.docNumber));
      const now = new Date(); const year = now.getFullYear(); const seq = Number(row.value) + 1;
      const docNumber = `${String(seq).padStart(3, "0")}/${doc.templateCode}/EPC/${roman[now.getMonth()]}/${year}`;
      const pdf = await renderDocumentPdf(doc.title, docNumber, (doc.blocks ?? []) as DocumentBlock[]); const fileId = newId();
      await tx.insert(fileObjects).values({ id: fileId, storageKey: `private/generated/${doc.projectId}/${docNumber.replace(/\//g, "-")}-r${doc.revisionNo}.pdf`, fileName: `${doc.title.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`, mimeType: "application/pdf", sizeBytes: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex"), contentBase64: pdf.toString("base64"), uploadedById: user.id });
      await tx.update(documents).set({ status: "FINAL", docNumber, fileId, finalizedAt: new Date() }).where(eq(documents.id, id));
      if (["BAST1", "BAST2"].includes(doc.templateCode)) {
        const [project] = await tx.select().from(projects).where(eq(projects.id, doc.projectId!));
        if (project) await tx.update(projects).set(doc.templateCode === "BAST1" ? { bast1Date: project.bast1Date || now.toISOString().slice(0, 10) } : { bast2Date: project.bast2Date || now.toISOString().slice(0, 10) }).where(eq(projects.id, project.id));
      }
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: doc.projectId, action: "FINALIZED", changes: [{ field: "status", old: doc.status, new: "FINAL" }, { field: "docNumber", old: null, new: docNumber }, { field: "pdfFileId", old: null, new: fileId }] });
      return { docNumber, fileId };
    });
    return Response.json({ data: { id, status: "FINAL", ...result } });
  } catch (error) { return errorResponse(error); }
}
