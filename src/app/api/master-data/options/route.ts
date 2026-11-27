import { errorResponse, requireUser } from "@/lib/auth";
import { getMasterDataOptions } from "@/modules/master-data/service";
import { companyRoute } from "@/shared/auth/route";

/** Opsi form (klien, site, pengguna, peran) untuk wizard proyek. */
async function GETHandler() {
  try {
    const user = await requireUser();
    return Response.json({ data: await getMasterDataOptions(user) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
