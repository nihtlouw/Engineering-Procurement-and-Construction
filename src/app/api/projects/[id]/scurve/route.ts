import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { getSCurve } from "@/modules/wbs/service";

/** Kurva-S proyek: rencana vs aktual per minggu + deviasi. */
async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return Response.json({ data: await getSCurve(user, id) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
