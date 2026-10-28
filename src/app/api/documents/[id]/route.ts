import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, documents } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ title: z.string().min(3).optional(), blocks: z.array(z.record(z.string(), z.unknown())).min(1) });
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); assertPermission(user, "gendoc.create"); const { id } = await params; const body = schema.parse(await request.json());
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1); if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
    await requireProject(user, doc.projectId, "gendoc.create");
    if (!["DRAFT", "IN_REVIEW"].includes(doc.status)) throw new ApiError("DOCUMENT_LOCKED", "Dokumen FINAL bersifat immutable. Buat revisi baru.", 409);
    await db.transaction(async (tx) => {
      await tx.update(documents).set({ title: body.title || doc.title, blocks: body.blocks }).where(eq(documents.id, id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: doc.projectId, action: "BLOCKS_EDITED", changes: [{ field: "blocks", old: "DRAFT_BLOCKS", new: "EDITED_BLOCKS" }, { field: "mergeSnapshot", old: "UNCHANGED", new: "UNCHANGED" }] });
    });
    return Response.json({ data: { id } });
  } catch (error) { return errorResponse(error); }
}
