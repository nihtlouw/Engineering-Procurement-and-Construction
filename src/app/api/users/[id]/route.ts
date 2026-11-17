import { assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { updateMemberSchema, updateMembership } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    assertPermission(user, "users.manage");
    const { id } = await params;
    const body = updateMemberSchema.parse(await request.json());
    const result = await updateMembership(user.companyId, id, body, { id: user.id, role: user.companyRole });
    return Response.json({ data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export const PATCH = companyRoute(PATCHHandler);
