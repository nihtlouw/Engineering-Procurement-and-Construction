import { errorResponse, requireUser } from "@/lib/auth";
import { removeProjectMember } from "@/modules/master-data/service";
import { companyRoute } from "@/shared/auth/route";

async function DELETEHandler(_request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    const user = await requireUser();
    const { id, memberId } = await params;
    return Response.json({ data: await removeProjectMember(user, id, memberId) });
  } catch (error) { return errorResponse(error); }
}

export const DELETE = companyRoute(DELETEHandler);
