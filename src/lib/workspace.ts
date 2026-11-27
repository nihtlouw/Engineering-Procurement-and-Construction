import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, budgetLines, budgetVersions, changeOrders, clients, companySettings, contractTerms,
  costCategories, customerInvoices, customerPayments, documents, expenseLines, expenses, handoverItems,
  notifications, opportunities, poItems, progressUpdates, projectMembers, projects, punchItems, purchaseRecords,
  scheduleItems, sites, units, users, variationOrderLines, variationOrders,
} from "@/db/schema";
import { hasPermission, safeUser, signFileToken } from "@/lib/auth";
import type { ProjectMetric, SessionUser, WorkspaceData } from "@/lib/domain";
import { buildCloseCheck, calculateProjectMetrics, displayInvoiceStatus, invoiceBalance } from "@/lib/finance";
import { D, money } from "@/lib/format";
import { listCompaniesForUser } from "@/modules/companies/service";
import { listWorkspaceFieldPhotos } from "@/modules/field-photos/service";

export async function getWorkspaceData(user: SessionUser): Promise<WorkspaceData> {
  const [
    allUsers, settingsRows, clientRows, siteRows, opportunityRows, projectRows, memberRows, categoryRows, unitRows,
    budgetRows, budgetLineRows, expenseRows, expenseLineRows, purchaseRows, invoiceRows, paymentRows, termRows,
    scheduleRows, progressRows, changeRows, punchRows, handoverRows, documentRows, activityRows, notificationRows,
    variationRows, variationLineRows, poItemRows,
  ] = await Promise.all([
    db.select().from(users), db.select().from(companySettings).limit(1), db.select().from(clients), db.select().from(sites),
    db.select().from(opportunities), db.select().from(projects), db.select().from(projectMembers), db.select().from(costCategories),
    db.select().from(units), db.select().from(budgetVersions), db.select().from(budgetLines), db.select().from(expenses).orderBy(desc(expenses.createdAt)),
    db.select().from(expenseLines), db.select().from(purchaseRecords), db.select().from(customerInvoices), db.select().from(customerPayments),
    db.select().from(contractTerms), db.select().from(scheduleItems), db.select().from(progressUpdates).orderBy(desc(progressUpdates.createdAt)),
    db.select().from(changeOrders), db.select().from(punchItems), db.select().from(handoverItems), db.select().from(documents).orderBy(desc(documents.createdAt)),
    db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(150), db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)),
    db.select().from(variationOrders), db.select().from(variationOrderLines), db.select().from(poItems),
  ]);
  const safeUsers = allUsers.map(safeUser);
  const scopedIds = user.role === "ADMIN" ? projectRows.map((p) => p.id) : memberRows.filter((m) => m.userId === user.id).map((m) => m.projectId);
  const allowedProjects = projectRows.filter((p) => scopedIds.includes(p.id));
  const allowedIds = allowedProjects.map((p) => p.id);
  const userMap = new Map(safeUsers.map((u) => [u.id, u]));
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));
  const siteMap = new Map(siteRows.map((s) => [s.id, s]));
  const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));
  const canInternal = hasPermission(user, "budget.internal.view");
  /** Siapa yang boleh membuka berkas nota: pelaku, approver, ADMIN, FINANCE. */
  const canSeeReceipt = (expense: { createdById: string; assignedApproverId: string | null }) =>
    expense.createdById === user.id || expense.assignedApproverId === user.id
    || user.role === "ADMIN" || user.role === "FINANCE";
  const canClient = hasPermission(user, "budget.client.view");
  const canProjectExpenses = hasPermission(user, "expense.view.project");
  const canOwnExpenses = hasPermission(user, "expense.view.own");
  const canInvoices = hasPermission(user, "invoice.view");
  const canPurchases = hasPermission(user, "purchase.view");
  const expires = Math.floor(Date.now() / 1000) + 300;
  const fileUrl = (id: string | null) => id ? `/api/files/${id}?expires=${expires}&signature=${signFileToken(id, expires)}` : null;

  const allExpensesWithLines = expenseRows.map((expense) => ({
    ...expense,
    lines: expenseLineRows.filter((line) => line.expenseId === expense.id),
    payments: [],
  }));
  const allInvoicesWithPayments = invoiceRows.map((invoice) => ({ ...invoice, payments: paymentRows.filter((p) => p.invoiceId === invoice.id) }));
  const metrics: Record<string, ProjectMetric> = {};
  const closeChecks: WorkspaceData["closeChecks"] = {};
  for (const project of allowedProjects) {
    const full = calculateProjectMetrics({ project, expenses: allExpensesWithLines, purchases: purchaseRows, invoices: allInvoicesWithPayments, budgets: budgetRows, schedule: scheduleRows, canViewInternal: canInternal });
    if (!hasPermission(user, "portfolio.view")) continue;
    if (!canProjectExpenses) {
      delete full.actualCost; delete full.pendingCost; delete full.forecastExposure; delete full.remainingBudget; delete full.indicativeMargin;
    }
    if (!canPurchases) { delete full.commitment; delete full.remainingCommitment; }
    if (!canInvoices) { delete full.invoiced; delete full.received; delete full.receivable; delete full.overdue; delete full.retentionOutstanding; }
    if (!canClient) delete full.contractValueCurrent;
    metrics[project.id] = full;
    closeChecks[project.id] = buildCloseCheck({ projectId: project.id, invoices: allInvoicesWithPayments, expenses: allExpensesWithLines, punchItems: punchRows, handoverItems: handoverRows });
  }

  // S2a · pagu per pos: komitmen PO yang belum direalisasi ikut dihitung.
  const committedByLine = new Map<string, ReturnType<typeof D>>();
  for (const po of purchaseRows) {
    if (!po.budgetLineId || !["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) continue;
    committedByLine.set(po.budgetLineId, (committedByLine.get(po.budgetLineId) ?? D(0)).plus(po.dppAmount));
  }

  const visibleBudgets = budgetRows.filter((b) => allowedIds.includes(b.projectId) && ((b.type === "INTERNAL" && canInternal) || (b.type === "CLIENT" && canClient))).map((budget) => ({
    ...budget,
    lines: budgetLineRows.filter((line) => line.budgetVersionId === budget.id).sort((a, b) => a.sortOrder - b.sortOrder).map((line) => {
      const category = categoryMap.get(line.costCategoryId);
      const enriched: Record<string, unknown> = {
        ...line, categoryCode: category?.code, categoryName: category?.name,
        paguAmount: money(D(line.total).times(D(1).plus(D(line.contingencyPct ?? 0).div(100)))),
        committedAmount: money(committedByLine.get(line.id) ?? D(0)),
      };
      if (budget.type === "INTERNAL") {
        enriched.actualAmount = money(allExpensesWithLines.filter((e) => e.approvalStatus === "APPROVED").reduce((sum, e) => sum.plus(e.lines.filter((l) => l.budgetLineId === line.id && l.scope === "PROJECT").reduce((s, l) => s.plus(l.lineTotal), D(0))), D(0)));
        enriched.pendingAmount = money(allExpensesWithLines.filter((e) => ["SUBMITTED", "NEEDS_CORRECTION"].includes(e.approvalStatus)).reduce((sum, e) => sum.plus(e.lines.filter((l) => l.budgetLineId === line.id && l.scope === "PROJECT").reduce((s, l) => s.plus(l.lineTotal), D(0))), D(0)));
      }
      return enriched;
    }),
  }));

  const visibleExpenses = allExpensesWithLines.filter((e) => {
    if (e.defaultScope === "OVERHEAD") return user.role === "ADMIN" || user.role === "FINANCE" || e.createdById === user.id;
    if (canProjectExpenses) return e.lines.some((l) => l.projectId && allowedIds.includes(l.projectId));
    return canOwnExpenses && e.createdById === user.id;
  }).map((e) => ({
    ...e,
    createdByName: userMap.get(e.createdById)?.name ?? "Pengguna tidak dikenal",
    approverName: e.assignedApproverId ? userMap.get(e.assignedApproverId)?.name : null,
    /* Audit #3: URL nota bertanda tangan adalah kredensial baca 5 menit. Hanya
       pembuat, approver, ADMIN, dan FINANCE yang menerimanya; pemegang
       `expense.view.project` lain melihat nota itu tanpa tautan berkas. */
    receiptUrl: canSeeReceipt(e) ? fileUrl(e.receiptFileId) : null,
    lines: e.lines.map((line) => {
      const budgetLine = budgetLineRows.find((b) => b.id === line.budgetLineId);
      return { ...line, categoryCode: categoryMap.get(line.costCategoryId)?.code, categoryName: categoryMap.get(line.costCategoryId)?.name, projectCode: projectRows.find((p) => p.id === line.projectId)?.code, budgetLineCode: budgetLine?.code, budgetLineDescription: budgetLine?.description };
    }),
  }));

  const visiblePurchases = canPurchases ? purchaseRows.filter((p) => allowedIds.includes(p.projectId)).map((po) => {
    const bills = allExpensesWithLines.filter((e) => e.purchaseRecordId === po.id && e.approvalStatus === "APPROVED");
    const billedAmount = bills.reduce((sum, e) => sum.plus(e.lines.reduce((s, l) => s.plus(l.lineTotal), D(0))), D(0));
    const items = poItemRows.filter((i) => i.purchaseRecordId === po.id).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ ...i, budgetLineCode: budgetLineRows.find((b) => b.id === i.budgetLineId)?.code ?? null }));
    return {
      ...po, projectCode: projectRows.find((p) => p.id === po.projectId)?.code,
      billedAmount: money(billedAmount), remainingAmount: money(D(po.dppAmount).minus(billedAmount)), items,
    };
  }) : [];
  const visibleInvoices = canInvoices ? allInvoicesWithPayments.filter((i) => allowedIds.includes(i.projectId)).map((invoice) => ({
    ...invoice, projectCode: projectRows.find((p) => p.id === invoice.projectId)?.code, balance: money(invoiceBalance(invoice)), displayStatus: displayInvoiceStatus(invoice),
  })) : [];
  // S4: dokumen unggahan tidak punya template; arsip tetap terlihat dengan status ARCHIVED.
  const visibleDocuments = hasPermission(user, "document.view") ? documentRows.filter((d) => !d.projectId || allowedIds.includes(d.projectId)).map((d) => ({
    ...d, fileUrl: fileUrl(d.fileId),
    docxUrl: fileUrl(d.docxFileId ?? null),
    projectCode: projectRows.find((p) => p.id === d.projectId)?.code,
  })) : [];
  // S3: CLIENT_VIEWER hanya menerima foto yang sudah diproyeksikan ke laporan.
  const visibleFieldPhotos = (await listWorkspaceFieldPhotos(user, allowedIds, expires))
    .filter((photo) => user.role !== "CLIENT_VIEWER" || photo.isSelectedForReport === true);

  /* ---- S1 · Redaksi payload (audit #3) ----------------------------------
   * Proyeksi per permission, BUKAN redaksi setelah mengirim: objek yang
   * dikirim memang tidak memuat field yang tidak berhak dilihat peran.
   * `safeUsers`, `clientRows`, `siteRows`, `projectRows` tetap dipakai penuh
   * di server untuk kalkulasi metrik & resolusi nama.
   * --------------------------------------------------------------------- */
  const isAdmin = user.companyRole === "ADMIN";
  const canSeeDirectory = isAdmin || user.companyRole === "FINANCE" || hasPermission(user, "settings.manage");
  const visibleDirectory = canSeeDirectory
    ? safeUsers.filter((u) => isAdmin || memberRows.some((m) => m.userId === u.id && allowedIds.includes(m.projectId)))
    : [];
  const publicClients = clientRows.map((c) => ({
    id: c.id, code: c.code, legalName: c.legalName, displayName: c.displayName, industry: c.industry,
    ...(canSeeDirectory ? { npwp: c.npwp, address: c.address, contactName: c.contactName, contactPhone: c.contactPhone } : {}),
    deletedAt: c.deletedAt, createdAt: c.createdAt,
  }));
  const publicSites = siteRows.map((s) => ({
    id: s.id, clientId: s.clientId, name: s.name, address: s.address,
    ...(canSeeDirectory ? { contact: s.contact, latitude: s.latitude, longitude: s.longitude } : {}),
  }));
  const publicProjects = allowedProjects.map((p) => ({
    ...p,
    // Nilai kontrak/PPN/retensi hanya untuk peran berhak (RAB klien).
    contractValue: canClient ? p.contractValue : "",
    contractPpn: canClient ? p.contractPpn : "",
    contractValueCurrent: canClient ? p.contractValueCurrent : "",
    retentionPct: canClient ? p.retentionPct : "",
    clientName: clientMap.get(p.clientId)?.displayName,
    clientLegalName: clientMap.get(p.clientId)?.legalName,
    siteName: p.siteId ? siteMap.get(p.siteId)?.name : null,
    siteAddress: p.siteId ? siteMap.get(p.siteId)?.address : null,
    pmName: p.pmId ? userMap.get(p.pmId)?.name : null,
  }));
  const publicSettings = {
    ...settingsRows[0],
    defaultPpnRate: settingsRows[0]?.defaultPpnRate ?? "11",
    allowSplitExpense: settingsRows[0]?.allowSplitExpense ?? false,
    npwp: canSeeDirectory ? settingsRows[0]?.npwp : null,
  };
  const companies = await listCompaniesForUser(user.id);
  // S2a: dampak biaya internal PTK TIDAK pernah dikirim ke peran tanpa izin.
  const visibleVariations = variationRows.filter((v) => allowedIds.includes(v.projectId)).map((v) => {
    const serialized: Record<string, unknown> = {
      ...v,
      createdByName: userMap.get(v.createdById)?.name,
      lines: canInternal ? variationLineRows.filter((l) => l.variationOrderId === v.id) : [],
    };
    if (!canInternal) delete serialized.costImpact;
    return serialized;
  });

  return {
    generatedAt: new Date().toISOString(), user, companies, users: visibleDirectory,
    settings: publicSettings,
    clients: publicClients, sites: publicSites,
    opportunities: hasPermission(user, "opportunity.view") ? opportunityRows.map((o) => ({ ...o, clientName: clientMap.get(o.clientId)?.displayName, ownerName: userMap.get(o.ownerId)?.name, converted: projectRows.some((p) => p.opportunityId === o.id) })) : [],
    projects: publicProjects,
    members: memberRows.filter((m) => allowedIds.includes(m.projectId)).map((m) => ({ ...m, userName: userMap.get(m.userId)?.name, userRole: userMap.get(m.userId)?.role })),
    categories: categoryRows.filter((c) => c.isActive && (canInternal || !c.isOverhead)).map((c) => ({ id: c.id, code: c.code, name: c.name, isOverhead: c.isOverhead })),
    units: unitRows.map((u) => ({ id: u.id, code: u.code, name: u.name })), budgets: visibleBudgets, expenses: visibleExpenses,
    purchases: visiblePurchases, invoices: visibleInvoices,
    terms: canClient ? termRows.filter((t) => allowedIds.includes(t.projectId)) : [],
    schedule: hasPermission(user, "schedule.view") ? scheduleRows.filter((s) => allowedIds.includes(s.projectId)).map((s) => ({ ...s, ownerName: s.ownerId ? userMap.get(s.ownerId)?.name : null })) : [],
    progressUpdates: hasPermission(user, "schedule.view") ? progressRows.filter((p) => allowedIds.includes(p.projectId)).map((p) => ({ ...p, createdByName: userMap.get(p.createdById)?.name })) : [],
    variationOrders: canClient ? visibleVariations : [],
    changeOrders: canClient ? changeRows.filter((c) => allowedIds.includes(c.projectId)).map((c) => { const serialized: Record<string, unknown> = { ...c, createdByName: userMap.get(c.createdById)?.name }; if (!canInternal) delete serialized.costImpact; return serialized; }) : [],
    punchItems: punchRows.filter((p) => allowedIds.includes(p.projectId)), handoverItems: handoverRows.filter((h) => allowedIds.includes(h.projectId)),
    documents: visibleDocuments,
    fieldPhotos: visibleFieldPhotos,
    /* `actorId` adalah identifier internal: klien hanya butuh nama + objek yang
       disentuh. Menyembunyikannya mengurangi permukaan enumerasi user. */
    activities: hasPermission(user, "audit.view") ? activityRows.filter((a) => !a.projectId || allowedIds.includes(a.projectId)).map(({ actorId, ...rest }) => ({ ...rest, actorName: actorId ? userMap.get(actorId)?.name : "Sistem" })) : [],
    notifications: notificationRows, metrics, closeChecks,
  };
}
