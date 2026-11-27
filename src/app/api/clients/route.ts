import { errorResponse, requireUser } from "@/lib/auth";
import { createClient } from "@/modules/master-data/service";
import { clientSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = clientSchema.parse(await request.json());
    return Response.json({ data: await createClient(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
