import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { createInvitation, inviteSchema } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const body = inviteSchema.parse(await request.json());
    const invitation = await createInvitation(user.companyId, body, user.id);
    return Response.json({ data: invitation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
