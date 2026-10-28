import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, budgetLines, budgetVersions, changeOrders, clients, companySettings, contractTerms, customerInvoices, documents, fileObjects, projects, scheduleItems, sites, users } from "@/db/schema";
import { ApiError, assertPermission, errorResponse, requireUser } from "@/lib/auth";
import { buildBlocks, DOCUMENT_TEMPLATES } from "@/lib/document-templates";
import { calculateProjectMetrics, invoiceBalance } from "@/lib/finance";
import { formatDate, formatIDR, terbilang } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";

const schema = z.object({ action: z.enum(["CREATE", "UPLOAD"]).default("CREATE"), projectId: z.string(), templateCode: z.string().optional(), relatedType: z.string().optional(), relatedId: z.string().optional(), title: z.string().optional(), category: z.string().optional(), fileId: z.string().optional() });
export async function POST(request: Request) {
  try {
    const user = await requireUser(); const body = schema.parse(await request.json()); await requireProject(user, body.projectId, body.action === "UPLOAD" ? "document.upload" : "gendoc.create");
    if (body.action === "UPLOAD") {
      if (!body.fileId || !body.title) throw new ApiError("INCOMPLETE_UPLOAD", "Judul dan file dokumen wajib diisi.", 422);
      const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, body.fileId)).limit(1);
      if (!file || file.uploadedById !== user.id) throw new ApiError("FILE_NOT_FOUND", "File tidak tersedia untuk akun ini.", 422);
      const id = newId(); await db.insert(documents).values({ id, projectId: body.projectId, category: body.category || "OTHER", title: body.title, templateCode: "OTHER", status: "ACTIVE", fileId: body.fileId, uploadedById: user.id });
      await db.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: body.projectId, action: "UPLOADED", changes: [{ field: "fileId", old: null, new: body.fileId }] });
      return Response.json({ data: { id } }, { status: 201 });
    }
    assertPermission(user, "gendoc.create");
    if (!DOCUMENT_TEMPLATES.some((t) => t.code === body.templateCode)) throw new ApiError("UNKNOWN_TEMPLATE", "Template dokumen tidak dikenal.", 422);
    const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId)); const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
    const [site] = project.siteId ? await db.select().from(sites).where(eq(sites.id, project.siteId)) : []; const [company] = await db.select().from(companySettings).limit(1);
    const pm = project.pmId ? (await db.select().from(users).where(eq(users.id, project.pmId)).limit(1))[0] : null;
    const snapshot: Record<string, string> = { projectCode: project.code, projectTitle: project.title, clientLegalName: client.legalName, clientContact: client.contactName || "", siteName: site?.name || "", contractNumber: project.contractNumber || "", contractValue: formatIDR(project.contractValue), companyLegalName: company.legalName, pmName: pm?.name || user.name, documentDate: formatDate(new Date()) };
    if (["INVOICE", "KWITANSI"].includes(body.templateCode!)) {
      const [invoice] = await db.select().from(customerInvoices).where(eq(customerInvoices.id, body.relatedId || "")).limit(1);
      if (!invoice || invoice.projectId !== project.id) throw new ApiError("INVOICE_REQUIRED", "Pilih invoice dari proyek yang sama.", 422);
      Object.assign(snapshot, { invoiceNumber: invoice.number, invoiceType: invoice.type, invoiceIssueDate: formatDate(invoice.issueDate), invoiceDueDate: formatDate(invoice.dueDate), invoiceDpp: formatIDR(invoice.dppAmount), invoicePpn: formatIDR(invoice.ppnAmount), invoiceTotal: formatIDR(invoice.totalAmount), invoiceTotalInWords: terbilang(invoice.totalAmount) });
    }
    if (body.templateCode === "PROGRESS_REPORT") {
      const items = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, project.id));
      const metrics = calculateProjectMetrics({ project, expenses: [], purchases: [], invoices: [], budgets: [], changeOrders: [], schedule: items, canViewInternal: false });
      snapshot.progressPct = String(metrics.progressPct); snapshot.scheduleRows = JSON.stringify(items.map((i) => ({ activity: i.name, plan: formatDate(i.plannedEnd), progress: `${i.progressPct}%`, status: i.status })));
    }
    if (body.templateCode === "RAB_CLIENT") {
      const clientBudget = (await db.select().from(budgetVersions).where(eq(budgetVersions.projectId, project.id))).find((b) => b.type === "CLIENT" && b.isActiveBaseline);
      const lines = clientBudget ? await db.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, clientBudget.id)) : [];
      snapshot.budgetRows = JSON.stringify(lines.map((l) => ({ code: l.code || "—", description: l.description, quantity: `${l.quantity} ${l.unitCode}`, amount: formatIDR(l.total) })));
    }
    if (body.templateCode === "CHANGE_ORDER") {
      const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, body.relatedId || "")).limit(1);
      if (!co || co.projectId !== project.id) throw new ApiError("CHANGE_ORDER_REQUIRED", "Pilih change order dari proyek yang sama.", 422);
      Object.assign(snapshot, { changeOrderCode: co.code, scopeDescription: co.scopeDescription, reason: co.reason, priceImpact: formatIDR(co.priceImpact), timeImpactDays: String(co.timeImpactDays) });
    }
    const blocks = buildBlocks(body.templateCode!, snapshot); const id = newId();
    const title = body.title || `${DOCUMENT_TEMPLATES.find((t) => t.code === body.templateCode)?.name} — ${project.code}`;
    await db.insert(documents).values({ id, projectId: project.id, relatedType: body.relatedType, relatedId: body.relatedId, category: body.templateCode?.startsWith("BAST") ? "BA" : body.templateCode === "INVOICE" ? "OTHER" : "OTHER", title, templateCode: body.templateCode!, templateVersion: 1, mergeSnapshot: snapshot, blocks, status: "DRAFT", uploadedById: user.id });
    await db.insert(activityLogs).values({ id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: project.id, action: "GENERATED", changes: [{ field: "templateCode", old: null, new: body.templateCode }, { field: "mergeSnapshot", old: null, new: "SNAPSHOT_STORED" }] });
    return Response.json({ data: { id, blocks, mergeSnapshot: snapshot } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
