import { errorResponse, requireUser } from "@/lib/auth";
import { listContractTerms, saveContractTerms } from "@/modules/master-data/service";
import { saveTermsSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return Response.json({ data: await listContractTerms(user, id) });
  } catch (error) { return errorResponse(error); }
}

/** Simpan daftar termin proyek sebagai satu kesatuan (persen harus 100%). */
async function PUTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = saveTermsSchema.parse(await request.json());
    return Response.json({ data: await saveContractTerms(user, id, body.terms) });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
export const PUT = companyRoute(PUTHandler);
