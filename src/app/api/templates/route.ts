import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { createTemplate, listTemplates } from "@/modules/documents/templates";
import { templateSchema } from "@/modules/documents/validation";

/** Daftar template (sistem + company) beserta variabel & nilai contoh. */
async function GETHandler() {
  try {
    const user = await requireUser();
    return Response.json({ data: await listTemplates(user) });
  } catch (error) { return errorResponse(error); }
}

/** Buat template company (blok atau DOCX). */
async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = templateSchema.parse(await request.json());
    return Response.json({ data: await createTemplate(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const POST = companyRoute(POSTHandler);
