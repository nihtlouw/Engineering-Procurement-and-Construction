import { errorResponse, requireUser } from "@/lib/auth";
import { createSite } from "@/modules/master-data/service";
import { siteSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = siteSchema.parse(await request.json());
    return Response.json({ data: await createSite(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
