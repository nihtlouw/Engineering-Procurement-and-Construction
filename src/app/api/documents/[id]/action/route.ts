import { z } from "zod";
import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { archiveDocument, finalizeDocument, reviseDocument } from "@/modules/documents/service";

const schema = z.object({
  action: z.enum(["FINALIZE", "REVISE", "ARCHIVE"]),
  reason: z.string().trim().max(300).optional(),
});

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { action, reason } = schema.parse(await request.json());
    if (action === "FINALIZE") return Response.json({ data: await finalizeDocument(user, id) });
    if (action === "REVISE") return Response.json({ data: await reviseDocument(user, id) }, { status: 201 });
    return Response.json({ data: await archiveDocument(user, id, reason) });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
