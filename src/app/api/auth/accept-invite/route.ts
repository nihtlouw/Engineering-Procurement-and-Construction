import { createSession, errorResponse } from "@/lib/auth";
import { acceptInvitation, acceptInviteSchema } from "@/modules/companies/service";
import { publicRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const body = acceptInviteSchema.parse(await request.json());
    const { userId, companyId } = await acceptInvitation(body);
    await createSession(userId, companyId);
    return Response.json({ data: { accepted: true } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = publicRoute(POSTHandler);
