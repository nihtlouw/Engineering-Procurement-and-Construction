import { errorResponse, requireUser } from "@/lib/auth";
import { createProject } from "@/modules/master-data/service";
import { projectSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

/** Wizard "Proyek baru": satu request = satu transaksi (proyek + anggota + audit). */
async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const body = projectSchema.parse(await request.json());
    return Response.json({ data: await createProject(user, body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
