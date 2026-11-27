import { errorResponse, requireUser } from "@/lib/auth";
import { closeContractTerm } from "@/modules/master-data/service";
import { closeTermSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

/** Tutup termin secara manual (mis. termin tidak akan ditagihkan lagi). */
async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string; termId: string }> }) {
  try {
    const user = await requireUser();
    const { id, termId } = await params;
    const body = closeTermSchema.parse(await request.json());
    return Response.json({ data: await closeContractTerm(user, id, termId, body.reason) });
  } catch (error) { return errorResponse(error); }
}

export const POST = companyRoute(POSTHandler);
