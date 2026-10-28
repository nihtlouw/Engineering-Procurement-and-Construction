import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, companySettings } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D } from "@/lib/format";
import { newId } from "@/lib/server-services";

const schema = z.object({ legalName: z.string().min(3), displayName: z.string().min(2), npwp: z.string().optional(), address: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional().or(z.literal("")), defaultPpnRate: z.string(), allowSplitExpense: z.boolean() });
export async function PATCH(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "settings.manage"); const body = schema.parse(await request.json());
    const [settings] = await db.select().from(companySettings).limit(1); if (!settings) throw new ApiError("NOT_FOUND", "Pengaturan perusahaan belum tersedia.", 404);
    if (D(body.defaultPpnRate).lt(0) || D(body.defaultPpnRate).gt(100)) throw new ApiError("INVALID_TAX_RATE", "Tarif PPN harus antara 0 dan 100.", 422);
    const changes = [{ field: "legalName", old: settings.legalName, new: body.legalName }, { field: "defaultPpnRate", old: settings.defaultPpnRate, new: body.defaultPpnRate }, { field: "allowSplitExpense", old: settings.allowSplitExpense, new: body.allowSplitExpense }].filter((c) => c.old !== c.new);
    await db.transaction(async (tx) => {
      await tx.update(companySettings).set({ ...body, email: body.email || null, updatedAt: new Date() }).where(eq(companySettings.id, settings.id));
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "COMPANY_SETTINGS", objectId: settings.id, action: "UPDATED", changes });
    });
    return Response.json({ data: { updated: true } });
  } catch (error) { return errorResponse(error); }
}
