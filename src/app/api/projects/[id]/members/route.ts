import { errorResponse, requireUser } from "@/lib/auth";
import { addProjectMember } from "@/modules/master-data/service";
import { projectMemberSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = projectMemberSchema.parse(await request.json());
    return Response.json({ data: await addProjectMember(user, id, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
