import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { archiveClient, updateClient } from "@/modules/master-data/service";
import { clientSchema } from "@/modules/master-data/validation";
import { companyRoute } from "@/shared/auth/route";

async function PATCHHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = clientSchema.parse(await request.json());
    return Response.json({ data: await updateClient(user, id, body) });
  } catch (error) { return errorResponse(error); }
}

const archiveSchema = z.object({ action: z.literal("ARCHIVE") });

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    archiveSchema.parse(await request.json().catch(() => ({ action: "ARCHIVE" })));
    return Response.json({ data: await archiveClient(user, id) });
  } catch (error) { return errorResponse(error); }
}

export const PATCH = companyRoute(PATCHHandler);
export const POST = companyRoute(POSTHandler);
