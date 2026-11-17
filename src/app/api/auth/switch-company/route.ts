import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { baseDb } from "@/db";
import { sessions } from "@/db/schema";
import { errorResponse, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { listCompaniesForUser, switchCompanySchema } from "@/modules/companies/service";
import { companyRoute } from "@/shared/auth/route";

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser();
    const { companyId } = switchCompanySchema.parse(await request.json());
    const allowed = await listCompaniesForUser(user.id);
    if (!allowed.some((c) => c.id === companyId)) {
      return Response.json({ code: "COMPANY_ACCESS_DENIED", message: "Anda bukan anggota aktif company ini." }, { status: 403 });
    }
    const store = await cookies();
    const sessionId = store.get(SESSION_COOKIE)?.value;
    if (!sessionId) return Response.json({ code: "UNAUTHENTICATED", message: "Sesi berakhir." }, { status: 401 });
    await baseDb.update(sessions).set({ companyId, lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
    return Response.json({ data: { companyId } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = companyRoute(POSTHandler);
