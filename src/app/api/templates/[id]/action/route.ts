import { z } from "zod";
import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { deactivateTemplate, duplicateTemplate } from "@/modules/documents/templates";

const schema = z.object({
  action: z.enum(["DUPLICATE", "DEACTIVATE"]),
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(300).optional(),
});

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = schema.parse(await request.json());
    if (body.action === "DUPLICATE") {
      return Response.json({ data: await duplicateTemplate(user, id, { code: body.code, name: body.name }) }, { status: 201 });
    }
    return Response.json({ data: await deactivateTemplate(user, id, body.reason) });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
