import { companyRoute } from "@/shared/auth/route";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, documents, fileObjects } from "@/db/schema";
import { ApiError, errorResponse, requireUser } from "@/lib/auth";
import { newId, requireProject } from "@/lib/server-services";
import { generateDocument, listProjectDocuments } from "@/modules/documents/service";

const schema = z.object({
  action: z.enum(["CREATE", "UPLOAD"]).default("CREATE"),
  projectId: z.string(),
  /** Template dari DB (disarankan); `templateCode` dipertahankan untuk UI lama. */
  templateId: z.string().optional(),
  templateCode: z.string().optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
  title: z.string().optional(),
  category: z.string().optional(),
  fileId: z.string().optional(),
});

async function GETHandler(request: Request) {
  try {
    const user = await requireUser();
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) throw new ApiError("PROJECT_REQUIRED", "Parameter projectId wajib diisi.", 422);
    return Response.json({ data: await listProjectDocuments(user, projectId) });
  } catch (error) { return errorResponse(error); }
}

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json());
    if (body.action === "UPLOAD") {
      await requireProject(user, body.projectId, "document.upload");
      if (!body.fileId || !body.title) throw new ApiError("INCOMPLETE_UPLOAD", "Judul dan file dokumen wajib diisi.", 422);
      const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, body.fileId)).limit(1);
      if (!file || file.uploadedById !== user.id) throw new ApiError("FILE_NOT_FOUND", "File tidak tersedia untuk akun ini.", 422);
      const id = newId();
      await db.insert(documents).values({
        id, projectId: body.projectId, category: body.category || "OTHER", title: body.title,
        templateCode: null, status: "ACTIVE", fileId: body.fileId, uploadedById: user.id,
      });
      await db.insert(activityLogs).values({
        id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: body.projectId,
        action: "UPLOADED", changes: [{ field: "fileId", old: null, new: body.fileId }],
      });
      return Response.json({ data: { id } }, { status: 201 });
    }
    if (!body.templateId && !body.templateCode) {
      throw new ApiError("TEMPLATE_REQUIRED", "Pilih template dokumen.", 422);
    }
    return Response.json({ data: await generateDocument(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const POST = companyRoute(POSTHandler);
