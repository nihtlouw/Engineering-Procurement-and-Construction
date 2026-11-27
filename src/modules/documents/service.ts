import { createHash } from "node:crypto";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, budgetLines, budgetVersions, changeOrders, clients, companySettings,
  contractTerms, customerInvoices, documents, documentTemplates, documentTemplateVariables,
  fileObjects, projects, scheduleItems, sites, users,
} from "@/db/schema";
import { ApiError, assertPermission, hasPermission } from "@/lib/auth";
import {
  buildBlocks, DOCUMENT_TEMPLATES, PHOTO_MERGE_FIELD, withPhotoRefs, type DocumentBlock,
} from "@/lib/document-templates";
import { buildDocxFromBlocks, DocxTemplateError, renderTemplateDocx } from "@/lib/docx";
import { calculateProjectMetrics, invoiceBalance } from "@/lib/finance";
import { formatDate, formatIDR, terbilang } from "@/lib/format";
import { renderDocumentPdf } from "@/lib/pdf";
import { newId, requiredReason, requireProject } from "@/lib/server-services";
import type { SessionUser } from "@/lib/domain";
import {
  attachSelectedPhotosToDocument, copyDocumentPhotoLinksForRevision,
  getDocumentPhotoBundle, getSelectedPhotoRefs,
} from "@/modules/field-photos/service";
import { getObjectBuffer, putObject, removeObject, type StoredFile } from "@/modules/field-photos/storage";
import { resolveTemplateForUse } from "@/modules/documents/templates";

/* -------------------------------------------------------------------------- */
/* S4 · generator dokumen: snapshot → blok/DOCX → preview → final → arsip      */
/* -------------------------------------------------------------------------- */

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PHOTO_TEMPLATE_CODES = new Set([
  "PROGRESS_REPORT", "BA_SURVEY", "BA_MOS", "BA_COMMISSIONING", "BAST1", "BAST2", "CHANGE_ORDER",
]);

type GenerateInput = {
  projectId: string;
  templateId?: string | null;
  templateCode?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  title?: string | null;
};

function isPhotoTemplate(code: string | null) {
  return !!code && PHOTO_TEMPLATE_CODES.has(code);
}

/** Nominal Rupiah dengan spasi tak-terputus agar shaping PDF tidak menggeser tanda. */
const rupiah = (value: unknown) => formatIDR(value as string).replace(/^(Rp)\s*/, "$1 ");

/**
 * Nilai tiap `source` variabel. Semua diambil dari snapshot saat generate:
 * dokumen FINAL tidak boleh berubah ketika data proyek berubah sesudahnya.
 */
async function buildSourceValues(user: SessionUser, input: GenerateInput) {
  const project = await requireProject(user, input.projectId, "gendoc.create");
  const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
  const [site] = project.siteId ? await db.select().from(sites).where(eq(sites.id, project.siteId)) : [];
  const [company] = await db.select().from(companySettings).limit(1);
  const pm = project.pmId
    ? (await db.select().from(users).where(eq(users.id, project.pmId)).limit(1))[0]
    : null;
  const values: Record<string, unknown> = {
    "project.code": project.code,
    "project.title": project.title,
    "project.contractNumber": project.contractNumber ?? "",
    "project.contractValue": rupiah(project.contractValue),
    "project.stage": project.stage,
    "project.startDate": project.startDate ? formatDate(project.startDate) : "",
    "project.targetEndDate": project.targetEndDate ? formatDate(project.targetEndDate) : "",
    "client.legalName": client?.legalName ?? "",
    "client.displayName": client?.displayName ?? "",
    "client.contactName": client?.contactName ?? "",
    "client.address": client?.address ?? "",
    "site.name": site?.name ?? "",
    "site.address": site?.address ?? "",
    "company.legalName": company?.legalName ?? "",
    "company.displayName": company?.displayName ?? "",
    "pm.name": pm?.name ?? user.name,
    "user.name": user.name,
    "document.date": formatDate(new Date()),
    "progress.pct": "0",
    "photos.selected": "",
  };

  // Dokumen sumber: invoice, kwitansi, atau change order pada proyek yang sama.
  if (input.relatedId) {
    const [invoice] = await db.select().from(customerInvoices).where(eq(customerInvoices.id, input.relatedId)).limit(1);
    if (invoice) {
      if (invoice.projectId !== project.id) {
        throw new ApiError("INVOICE_REQUIRED", "Pilih invoice dari proyek yang sama.", 422);
      }
      Object.assign(values, {
        "invoice.number": invoice.number,
        "invoice.type": invoice.type,
        "invoice.issueDate": formatDate(invoice.issueDate),
        "invoice.dueDate": formatDate(invoice.dueDate),
        "invoice.dpp": rupiah(invoice.dppAmount),
        "invoice.ppn": rupiah(invoice.ppnAmount),
        "invoice.total": rupiah(invoice.totalAmount),
        "invoice.totalInWords": terbilang(invoice.totalAmount),
      });
    }
    const [changeOrder] = await db.select().from(changeOrders).where(eq(changeOrders.id, input.relatedId)).limit(1);
    if (changeOrder) {
      if (changeOrder.projectId !== project.id) {
        throw new ApiError("CHANGE_ORDER_REQUIRED", "Pilih change order dari proyek yang sama.", 422);
      }
      Object.assign(values, {
        "changeOrder.code": changeOrder.code,
        "changeOrder.scopeDescription": changeOrder.scopeDescription ?? "",
        "changeOrder.reason": changeOrder.reason ?? "",
        "changeOrder.priceImpact": rupiah(changeOrder.priceImpact),
        "changeOrder.timeImpactDays": String(changeOrder.timeImpactDays ?? 0),
      });
    }
  }

  const invoiceRows = await db.select().from(customerInvoices).where(eq(customerInvoices.projectId, project.id));
  const invoicedTotal = invoiceRows
    .filter((row) => row.status !== "CANCELLED")
    .reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0);
  values["project.invoicedTotal"] = formatIDR(invoicedTotal);
  const terms = await db.select().from(contractTerms).where(eq(contractTerms.projectId, project.id));
  values["project.termCount"] = String(terms.length);

  const clientBudget = (await db.select().from(budgetVersions).where(eq(budgetVersions.projectId, project.id)))
    .find((budget) => budget.type === "CLIENT" && budget.isActiveBaseline);
  const lines = clientBudget
    ? await db.select().from(budgetLines).where(eq(budgetLines.budgetVersionId, clientBudget.id))
    : [];
  values["budget.rows"] = lines.map((line) => ({
    code: line.code || "-",
    description: line.description,
    quantity: `${line.quantity} ${line.unitCode}`,
    amount: formatIDR(line.total),
  }));

  const items = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, project.id));
  const metrics = calculateProjectMetrics({
    project, expenses: [], purchases: [], invoices: [], budgets: [], schedule: items, canViewInternal: false,
  });
  values["progress.pct"] = String(metrics.progressPct);
  values["schedule.rows"] = items.map((item) => ({
    activity: item.name,
    plan: formatDate(item.plannedEnd),
    progress: `${item.progressPct}%`,
    status: item.status,
  }));

  const photoRefs = isPhotoTemplate(input.templateCode ?? null)
    ? await getSelectedPhotoRefs(project.id)
    : [];
  values["photos.selected"] = photoRefs;
  return { project, values, photoRefs };
}

/** Nilai legacy (`projectCode`, `invoiceTotal`, ...) untuk renderer blok bawaan. */
function legacySnapshot(values: Record<string, unknown>): Record<string, string> {
  const text = (key: string) => {
    const value = values[key];
    return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  };
  return {
    projectCode: text("project.code"),
    projectTitle: text("project.title"),
    clientLegalName: text("client.legalName"),
    clientContact: text("client.contactName"),
    siteName: text("site.name"),
    contractNumber: text("project.contractNumber"),
    contractValue: text("project.contractValue"),
    companyLegalName: text("company.legalName"),
    pmName: text("pm.name"),
    documentDate: text("document.date"),
    invoiceNumber: text("invoice.number"),
    invoiceType: text("invoice.type"),
    invoiceIssueDate: text("invoice.issueDate"),
    invoiceDueDate: text("invoice.dueDate"),
    invoiceDpp: text("invoice.dpp"),
    invoicePpn: text("invoice.ppn"),
    invoiceTotal: text("invoice.total"),
    invoiceTotalInWords: text("invoice.totalInWords"),
    changeOrderCode: text("changeOrder.code"),
    scopeDescription: text("changeOrder.scopeDescription"),
    reason: text("changeOrder.reason"),
    priceImpact: text("changeOrder.priceImpact"),
    timeImpactDays: text("changeOrder.timeImpactDays"),
    progressPct: text("progress.pct"),
    scheduleRows: JSON.stringify(values["schedule.rows"] ?? []),
    budgetRows: JSON.stringify(values["budget.rows"] ?? []),
    [PHOTO_MERGE_FIELD]: JSON.stringify(values["photos.selected"] ?? []),
  };
}

/** Tag `{nama}` / `{nama}` di dalam blok diisi dari snapshot (template company). */
export function interpolateBlocks(blocks: DocumentBlock[], data: Record<string, unknown>): DocumentBlock[] {
  const fill = (value: string) => value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, tag: string) => {
    const resolved = data[tag];
    return resolved === undefined || resolved === null ? match : String(resolved);
  });
  return blocks.map((block) => {
    if (block.type === "heading") return { ...block, text: fill(block.text) };
    if (block.type === "paragraph") return { ...block, text: fill(block.text) };
    if (block.type === "keyValue") return { ...block, rows: block.rows.map((row) => ({ label: fill(row.label), value: fill(row.value) })) };
    if (block.type === "table") {
      return {
        ...block,
        columns: block.columns.map((column) => ({ ...column, label: fill(column.label) })),
        rows: block.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fill(String(value ?? ""))]))),
      };
    }
    if (block.type === "signature") {
      return {
        ...block,
        parties: block.parties.map((party) => ({
          label: fill(party.label), name: fill(party.name), title: fill(party.title),
          date: party.date ? fill(party.date) : party.date,
        })),
      };
    }
    return block;
  });
}

/** Placeholder `{tag}` yang belum terisi dilaporkan sebagai peringatan, bukan error. */
export function unresolvedTags(blocks: DocumentBlock[], data: Record<string, unknown>) {
  const missing = new Set<string>();
  const scan = (value: string) => {
    for (const match of value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
      if (data[match[1]] === undefined || data[match[1]] === null || data[match[1]] === "") missing.add(match[1]);
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" || block.type === "paragraph") scan(block.text);
    else if (block.type === "keyValue") block.rows.forEach((row) => { scan(row.label); scan(row.value); });
    else if (block.type === "table") {
      block.columns.forEach((column) => scan(column.label));
      block.rows.forEach((row) => Object.values(row).forEach((value) => scan(String(value ?? ""))));
    } else if (block.type === "signature") {
      block.parties.forEach((party) => { scan(party.label); scan(party.name); scan(party.title); });
    }
  }
  return [...missing];
}

function templateVariableData(values: Record<string, unknown>, variables: { tag: string; source: string }[]) {
  return Object.fromEntries(
    variables.map((variable) => [variable.tag, values[variable.source] ?? ""]),
  );
}

/** DOCX hasil generate disimpan privat; hanya id file yang dicatat di dokumen. */
async function storeDocx(user: SessionUser, projectId: string, buffer: Buffer, baseName: string) {
  const fileId = newId();
  const storageKey = `private/generated/${projectId}/docx/${fileId}.docx`;
  const stored = await putObject(buffer, storageKey, DOCX_MIME);
  try {
    await db.insert(fileObjects).values({
      id: fileId, storageKey, fileName: `${baseName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 80) || "dokumen"}.docx`,
      mimeType: DOCX_MIME, sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      contentBase64: null, storageProvider: stored.storageProvider, storageBucket: stored.storageBucket,
      uploadedById: user.id,
    });
  } catch (error) {
    await removeObject(storageKey, stored.storageProvider, stored.storageBucket);
    throw error;
  }
  return fileId;
}

/**
 * Buat dokumen DRAFT dari template. Template dicari lewat `templateId` (DB) atau
 * `templateCode` (kompatibilitas UI lama). Snapshot + salinan template dibekukan
 * di baris dokumen sehingga perubahan template sesudahnya tidak mengubah draft.
 */
export async function generateDocument(user: SessionUser, input: GenerateInput) {
  assertPermission(user, "gendoc.create");

  let templateId = input.templateId ?? null;
  if (!templateId && input.templateCode) {
    const rows = await db.select({ id: documentTemplates.id, companyId: documentTemplates.companyId })
      .from(documentTemplates).where(eq(documentTemplates.code, input.templateCode));
    const visible = rows.find((row) => row.companyId === user.companyId) ?? rows.find((row) => row.companyId === null);
    templateId = visible?.id ?? null;
  }

  const { project, values, photoRefs } = await buildSourceValues(user, input);
  const legacy = legacySnapshot(values);

  let template: typeof documentTemplates.$inferSelect | null = null;
  let variables: (typeof documentTemplateVariables.$inferSelect)[] = [];
  let code = input.templateCode ?? null;
  if (templateId) {
    const resolved = await resolveTemplateForUse(user, templateId);
    template = resolved.template;
    variables = resolved.variables;
    code = template.code;
    Object.assign(values, templateVariableData(values, variables));
  }

  if (!code) throw new ApiError("TEMPLATE_REQUIRED", "Pilih template dokumen.", 422);

  let blocks: DocumentBlock[];
  if (template && template.kind === "BLOCKS" && Array.isArray(template.blocks) && template.blocks.length) {
    blocks = interpolateBlocks(template.blocks as DocumentBlock[], values);
  } else if (!template || template.isSystem) {
    // Template sistem belum punya blok di DB: renderer bawaan menjaga keluaran lama.
    blocks = buildBlocks(code, legacy);
  } else {
    // Template DOCX: PDF dibuat dari ringkasan variabel agar tetap ada arsip visual.
    blocks = docxSummaryBlocks(template, values, variables);
  }
  blocks = withPhotoRefs(blocks, photoRefs);
  legacy[PHOTO_MERGE_FIELD] = JSON.stringify(photoRefs);

  const title = input.title?.trim()
    || `${template?.name ?? DOCUMENT_TEMPLATES.find((t) => t.code === code)?.name ?? "Dokumen"} — ${project.code}`;
  const id = newId();
  const category = template?.category
    ?? (code.startsWith("BAST") ? "BA" : "OTHER");

  await db.transaction(async (tx) => {
    await tx.insert(documents).values({
      id, projectId: project.id,
      relatedType: input.relatedType ?? (["INVOICE", "KWITANSI", "CHANGE_ORDER"].includes(code!) ? code : "PROJECT"),
      relatedId: input.relatedId ?? null,
      category, title, templateCode: code, templateId: template?.id ?? null,
      templateName: template?.name ?? DOCUMENT_TEMPLATES.find((t) => t.code === code)?.name ?? null,
      templateVersion: template?.version ?? 1,
      templateSnapshot: template ? {
        id: template.id, code: template.code, name: template.name, kind: template.kind,
        version: template.version, blocks: template.blocks ?? null, docxFileId: template.docxFileId,
        signatureParties: template.signatureParties ?? null,
        variables: variables.map((variable) => ({ tag: variable.tag, source: variable.source, label: variable.label })),
      } : null,
      mergeSnapshot: legacy, blocks, status: "DRAFT", uploadedById: user.id,
    });
    await attachSelectedPhotosToDocument(user, id, photoRefs, tx);
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: id, projectId: project.id,
      action: "GENERATED",
      changes: [
        { field: "templateCode", old: null, new: code },
        { field: "templateId", old: null, new: template?.id ?? null },
        { field: "mergeSnapshot", old: null, new: "SNAPSHOT_STORED" },
        { field: "photoCount", old: null, new: photoRefs.length },
      ],
    });
  });

  return {
    id, blocks, mergeSnapshot: legacy, photoCount: photoRefs.length,
    templateId: template?.id ?? null, templateName: template?.name ?? null,
    unresolved: unresolvedTags(blocks, values),
  };
}

function docxSummaryBlocks(
  template: typeof documentTemplates.$inferSelect,
  values: Record<string, unknown>,
  variables: (typeof documentTemplateVariables.$inferSelect)[],
): DocumentBlock[] {
  const rows = variables.map((variable) => ({
    label: variable.label,
    value: String(values[variable.tag] ?? "—"),
  }));
  return [
    { type: "heading", level: 1, text: template.name.toUpperCase() },
    { type: "paragraph", text: template.description ?? "Dokumen dibuat dari template DOCX." },
    { type: "keyValue", rows: rows.length ? rows : [{ label: "Proyek", value: String(values["project.code"] ?? "—") }] },
  ];
}

/** Nomor dokumen transaksional: 001/CODE/EPC/BULAN/TAHUN dengan lock advisory. */
async function allocateDocNumber(templateCode: string) {
  const [row] = await db.select({ value: count() }).from(documents).where(isNotNull(documents.docNumber));
  const now = new Date();
  const seq = Number(row.value) + 1;
  return {
    docNumber: `${String(seq).padStart(3, "0")}/${templateCode}/EPC/${ROMAN[now.getMonth()]}/${now.getFullYear()}`,
    now,
  };
}

/**
 * Finalisasi: nomor dialokasikan, DOCX + PDF dibuat dan disimpan di object
 * storage, dokumen dikunci FINAL. Sumber gambar foto adalah link foto (bukan
 * URL presigned yang kedaluwarsa).
 */
export async function finalizeDocument(user: SessionUser, documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
  await requireProject(user, doc.projectId, "gendoc.finalize");
  if (doc.status !== "DRAFT" && doc.status !== "IN_REVIEW") {
    throw new ApiError("DOCUMENT_LOCKED", "Dokumen FINAL tidak dapat diubah. Buat revisi baru.", 409);
  }
  const code = doc.templateCode ?? "DOKUMEN";
  const snapshot = (doc.mergeSnapshot ?? {}) as Record<string, string>;
  const photoBundle = await getDocumentPhotoBundle(documentId, snapshot[PHOTO_MERGE_FIELD]);
  const blocks = withPhotoRefs((doc.blocks ?? []) as DocumentBlock[], photoBundle.refs);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(771204)`);
    const { docNumber, now } = await allocateDocNumber(code);

    // PDF selalu dibuat dari blok: sumber arsip visual yang konsisten.
    const pdf = await renderDocumentPdf(doc.title, docNumber, blocks, { photoSources: photoBundle.sources });
    const fileId = newId();
    const pdfKey = `private/generated/${doc.projectId}/${docNumber.replace(/\//g, "-")}-r${doc.revisionNo}.pdf`;
    // Byte PDF ke object storage (bukan base64 di DB); DB hanya menyimpan metadata.
    const storedPdf = await putObject(pdf, pdfKey, "application/pdf");
    await tx.insert(fileObjects).values({
      id: fileId, storageKey: pdfKey,
      fileName: `${doc.title.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`,
      mimeType: "application/pdf", sizeBytes: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"), contentBase64: null,
      storageProvider: storedPdf.storageProvider, storageBucket: storedPdf.storageBucket,
      uploadedById: user.id,
    });

    // DOCX: dari berkas template admin bila ada, jika tidak dibangun dari blok.
    let docxFileId: string | null = null;
    const sourceDocx = await resolveSourceDocx(doc);
    const docxBuffer = sourceDocx
      ? renderTemplateDocx(sourceDocx, { ...snapshot, ...templateDataFromSnapshot(doc) }, { required: requiredTagsFromSnapshot(doc) })
      : buildDocxFromBlocks(blocks, { title: doc.title, docNumber });
    docxFileId = await storeDocx(user, doc.projectId!, docxBuffer, doc.title);

    await tx.update(documents).set({ status: "FINAL", docNumber, fileId, docxFileId, finalizedAt: now })
      .where(eq(documents.id, documentId));

    if (doc.templateCode && ["BAST1", "BAST2"].includes(doc.templateCode)) {
      const [project] = await tx.select().from(projects).where(eq(projects.id, doc.projectId!));
      if (project) {
        await tx.update(projects).set(doc.templateCode === "BAST1"
          ? { bast1Date: project.bast1Date || now.toISOString().slice(0, 10) }
          : { bast2Date: project.bast2Date || now.toISOString().slice(0, 10) })
          .where(eq(projects.id, project.id));
      }
    }
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: documentId, projectId: doc.projectId,
      action: "FINALIZED",
      changes: [
        { field: "status", old: doc.status, new: "FINAL" },
        { field: "docNumber", old: null, new: docNumber },
        { field: "pdfFileId", old: null, new: fileId },
        { field: "docxFileId", old: null, new: docxFileId },
        { field: "templateVersion", old: null, new: doc.templateVersion },
      ],
    });
    return { docNumber, fileId, docxFileId };
  });

  return { id: documentId, status: "FINAL", ...result };
}

function templateDataFromSnapshot(doc: typeof documents.$inferSelect) {
  const snapshot = (doc.templateSnapshot ?? null) as { variables?: { tag: string; source: string }[] } | null;
  const merge = (doc.mergeSnapshot ?? {}) as Record<string, string>;
  const data: Record<string, string> = {};
  for (const variable of snapshot?.variables ?? []) {
    data[variable.tag] = merge[variable.source] ?? merge[variable.tag] ?? "";
  }
  return data;
}

function requiredTagsFromSnapshot(doc: typeof documents.$inferSelect) {
  const snapshot = (doc.templateSnapshot ?? null) as { variables?: { tag: string; isRequired?: boolean }[] } | null;
  return (snapshot?.variables ?? []).filter((variable) => variable.isRequired).map((variable) => variable.tag);
}

async function resolveSourceDocx(doc: typeof documents.$inferSelect) {
  const snapshot = (doc.templateSnapshot ?? null) as { docxFileId?: string | null; kind?: string } | null;
  const fileId = snapshot?.docxFileId;
  if (!fileId) return null;
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, fileId)).limit(1);
  if (!file) return null;
  return getObjectBuffer(file as StoredFile);
}

/** Revisi baru dari dokumen FINAL (dokumen lama menjadi SUPERSEDED). */
export async function reviseDocument(user: SessionUser, documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
  await requireProject(user, doc.projectId, "gendoc.create");
  if (doc.status !== "FINAL") throw new ApiError("NOT_FINAL", "Hanya dokumen FINAL yang dapat direvisi.", 409);
  const newDocId = newId();
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ status: "SUPERSEDED" }).where(eq(documents.id, documentId));
    await tx.insert(documents).values({
      id: newDocId, projectId: doc.projectId, relatedType: doc.relatedType, relatedId: doc.relatedId,
      category: doc.category, title: doc.title, versionNo: doc.versionNo, revisionNo: doc.revisionNo + 1,
      templateCode: doc.templateCode, templateId: doc.templateId, templateName: doc.templateName,
      templateVersion: doc.templateVersion, templateSnapshot: doc.templateSnapshot,
      mergeSnapshot: doc.mergeSnapshot, blocks: doc.blocks, status: "DRAFT", uploadedById: user.id,
    });
    await copyDocumentPhotoLinksForRevision(tx, documentId, newDocId, user.id);
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: newDocId, projectId: doc.projectId,
      action: "REVISED",
      changes: [
        { field: "revisionNo", old: doc.revisionNo, new: doc.revisionNo + 1 },
        { field: "previousDocumentId", old: null, new: doc.id },
      ],
    });
  });
  return { id: newDocId };
}

/** Edit blok dokumen DRAFT/IN_REVIEW secara visual (bukan JSON mentah). */
export async function updateDocumentContent(
  user: SessionUser,
  documentId: string,
  input: { title?: string; blocks: Record<string, unknown>[] },
) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
  await requireProject(user, doc.projectId, "gendoc.create");
  if (!["DRAFT", "IN_REVIEW"].includes(doc.status)) {
    throw new ApiError("DOCUMENT_LOCKED", "Dokumen FINAL bersifat immutable. Buat revisi baru.", 409);
  }
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ title: input.title?.trim() || doc.title, blocks: input.blocks })
      .where(eq(documents.id, documentId));
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: documentId, projectId: doc.projectId,
      action: "BLOCKS_EDITED",
      changes: [
        { field: "blocks", old: "DRAFT_BLOCKS", new: "EDITED_BLOCKS" },
        { field: "mergeSnapshot", old: "UNCHANGED", new: "UNCHANGED" },
      ],
    });
  });
  return { id: documentId };
}

/**
 * Arsip: FINAL tetap immutable (PDF/DOCX disimpan), hanya status yang diubah.
 * Dokumen FINAL yang diarsipkan tidak bisa direvisi lagi.
 */
export async function archiveDocument(user: SessionUser, documentId: string, reason: unknown) {
  const note = requiredReason(reason, "Alasan pengarsipan dokumen");
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || !doc.projectId) throw new ApiError("NOT_FOUND", "Dokumen tidak ditemukan.", 404);
  await requireProject(user, doc.projectId, "document.upload");
  if (doc.status === "ARCHIVED") return { id: documentId, status: "ARCHIVED", changed: false };
  if (doc.status === "DRAFT" && !hasPermission(user, "gendoc.create")) {
    throw new ApiError("FORBIDDEN", "Hanya pembuat dokumen yang dapat mengarsipkan draft.", 403);
  }
  await db.transaction(async (tx) => {
    await tx.update(documents).set({
      status: "ARCHIVED", archivedAt: new Date(), archivedById: user.id, archiveReason: note,
    }).where(eq(documents.id, documentId));
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "DOCUMENT", objectId: documentId, projectId: doc.projectId,
      action: "ARCHIVED", reason: note,
      changes: [{ field: "status", old: doc.status, new: "ARCHIVED" }],
    });
  });
  return { id: documentId, status: "ARCHIVED", changed: true };
}

/** Ringkasan dokumen untuk workspace: termasuk DOCX dan template aktif. */
export async function listProjectDocuments(user: SessionUser, projectId: string) {
  await requireProject(user, projectId, "document.view");
  const rows = await db.select({
    id: documents.id, title: documents.title, status: documents.status, category: documents.category,
    docNumber: documents.docNumber, revisionNo: documents.revisionNo, templateCode: documents.templateCode,
    templateId: documents.templateId, templateName: documents.templateName, templateVersion: documents.templateVersion,
    docxFileId: documents.docxFileId, fileId: documents.fileId, createdAt: documents.createdAt,
    finalizedAt: documents.finalizedAt, archivedAt: documents.archivedAt, archiveReason: documents.archiveReason,
  }).from(documents).where(and(eq(documents.projectId, projectId)));
  return rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

// `invoiceBalance` dipertahankan sebagai re-export untuk tes finance lama.
export { invoiceBalance };
