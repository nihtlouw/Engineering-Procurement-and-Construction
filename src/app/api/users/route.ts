import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { listMembers, listPendingInvites } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

async function GETHandler() {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const [members, pending] = await Promise.all([
      listMembers(user.companyId), listPendingInvites(user.companyId),
    ]);
    return Response.json({ data: { members, pending, company: { id: user.companyId, name: user.companyName } } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = companyRoute(GETHandler);
