import { companyRoute } from "@/shared/auth/route";
import { errorResponse, requireUser } from "@/lib/auth";
import { listWbs, listWbsCalendars, saveWbs } from "@/modules/wbs/service";
import { saveWbsSchema } from "@/modules/wbs/validation";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return Response.json({
      data: { items: await listWbs(id), calendars: await listWbsCalendars(id) },
      meta: { userId: user.id },
    });
  } catch (error) { return errorResponse(error); }
}

/** Simpan WBS sebagai satu kesatuan (replace-by-set, Σ bobot 100%). */
async function PUTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = saveWbsSchema.parse(await request.json());
    return Response.json({ data: await saveWbs(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const PUT = companyRoute(PUTHandler);
