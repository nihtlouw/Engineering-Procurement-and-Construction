import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, contractTerms, customerInvoices } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { D, money } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ projectId: z.string(), contractTermId: z.string().nullable().optional(), type: z.enum(["DP", "MOS", "PROGRESS", "FINAL", "RETENTION", "OTHER"]), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dppAmount: z.string(), ppnAmount: z.string(), number: z.string().optional() });
const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export async function POST(request: Request) {
  try {
    const user = await requireUser(); assertPermission(user, "invoice.edit"); const body = schema.parse(await request.json());
    await requireProject(user, body.projectId, "invoice.edit");
    if (body.dueDate < body.issueDate) throw new ApiError("INVALID_DUE_DATE", "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice.", 422);
    if (D(body.dppAmount).lte(0) || D(body.ppnAmount).lt(0)) throw new ApiError("INVALID_AMOUNT", "DPP harus positif dan PPN tidak boleh negatif.", 422);
    if (body.contractTermId) {
      const [term] = await db.select().from(contractTerms).where(eq(contractTerms.id, body.contractTermId)).limit(1);
      if (!term || term.projectId !== body.projectId) throw new ApiError("TERM_MISMATCH", "Termin tidak sesuai dengan proyek.", 422);
    }
    const id = newId(); const total = D(body.dppAmount).plus(body.ppnAmount);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771202)`);
      const [row] = await tx.select({ value: count() }).from(customerInvoices);
      const issue = new Date(`${body.issueDate}T12:00:00+07:00`); const year = body.issueDate.slice(0, 4);
      const number = body.number?.trim() || `${String(Number(row.value) + 1).padStart(3, "0")}/INV/EPC/${roman[issue.getMonth()]}/${year}`;
      const existing = await tx.select({ id: customerInvoices.id }).from(customerInvoices).where(eq(customerInvoices.number, number)).limit(1);
      if (existing.length) throw new ApiError("DUPLICATE_NUMBER", "Nomor invoice sudah digunakan.", 409);
      await tx.insert(customerInvoices).values({ id, projectId: body.projectId, contractTermId: body.contractTermId, number, type: body.type, issueDate: body.issueDate, dueDate: body.dueDate, dppAmount: money(body.dppAmount), ppnAmount: money(body.ppnAmount), totalAmount: money(total), status: "DRAFT" });
      await tx.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "INVOICE", objectId: id, projectId: body.projectId, action: "CREATED", changes: [{ field: "totalAmount", old: null, new: money(total) }, { field: "status", old: null, new: "DRAFT" }] });
      return { id, number };
    });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
