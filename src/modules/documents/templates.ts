import { and, asc, count, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  documentTemplates, documentTemplateVariables, documentTemplateVersions, documents, fileObjects,
} from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import { newId, requiredReason } from "@/lib/server-services";
import type { SessionUser } from "@/lib/domain";
import type { DocumentBlock } from "@/lib/document-templates";
import { DOCUMENT_TEMPLATES } from "@/lib/document-templates";
import { extractDocxTags, isDocxBuffer } from "@/lib/docx";
import { getObjectBuffer, putObject, removeObject, type StoredFile } from "@/modules/field-photos/storage";
import {
  DEFAULT_TEMPLATE_VARIABLES, DOCX_MAX_BYTES, SYSTEM_TEMPLATE_READONLY,
  type TemplateInput, type TemplateVariableInput,
} from "@/modules/documents/validation";
import { audit } from "@/lib/server-services";

/* -------------------------------------------------------------------------- */
/* S4 · template dokumen dikelola admin (DB), bukan hardcode                   */
/* -------------------------------------------------------------------------- */

export function assertTemplateManage(user: SessionUser) {
  if (!hasPermission(user, "template.manage")) {
    throw new ApiError("FORBIDDEN", "Izin template.manage diperlukan untuk mengelola template dokumen.", 403);
  }
}

export type TemplateRecord = {
  id: string; companyId: string | null; code: string; name: string; description: string | null;
  category: string; baseCode: string | null; version: number; kind: string;
  blocks: DocumentBlock[] | null; docxFileId: string | null; signatureParties: { label: string; name: string; title: string }[] | null;
  isActive: boolean; isSystem: boolean; updatedAt: Date;
};

/** Template sistem (company_id NULL) + varian company aktif. */
export async function listTemplates(user: SessionUser) {
  const rows = await db.select().from(documentTemplates)
    .where(or(isNull(documentTemplates.companyId), eq(documentTemplates.companyId, user.companyId)));
  const variables = await db.select().from(documentTemplateVariables);
  // Dokumen memakai template_id; hitung per template agar UI bisa menonaktifkan hapus.
  const usage = await db.select({ templateId: documents.templateId, n: count() }).from(documents)
    .where(isNotNull(documents.templateId)).groupBy(documents.templateId);
  const usedIds = new Set(usage.map((row) => row.templateId));
  return {
    templates: rows
      .sort((a, b) => Number(!a.isSystem) - Number(!b.isSystem) || a.code.localeCompare(b.code))
      .map((row) => ({
        id: row.id, companyId: row.companyId, code: row.code, name: row.name, description: row.description,
        category: row.category, baseCode: row.baseCode, version: row.version, kind: row.kind,
        blocks: (row.blocks ?? null) as DocumentBlock[] | null,
        blockCount: ((row.blocks ?? []) as DocumentBlock[]).length,
        docxFileId: row.docxFileId, hasDocx: !!row.docxFileId,
        isActive: row.isActive, isSystem: row.isSystem,
        shared: row.companyId === null, used: usedIds.has(row.id),
        variableCount: variables.filter((v) => v.templateId === row.id).length,
        updatedAt: row.updatedAt,
      })),
    variables: variables.map((v) => ({
      id: v.id, templateId: v.templateId, tag: v.tag, label: v.label, varType: v.varType,
      source: v.source, sampleValue: v.sampleValue, isRequired: v.isRequired, sortOrder: v.sortOrder,
    })),
    defaults: DEFAULT_TEMPLATE_VARIABLES,
  };
}

export async function getTemplate(templateId: string) {
  const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
  if (!template) throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
  return template;
}

/** Template yang boleh dipakai generator: sistem atau milik company aktif. */
export async function resolveTemplateForUse(user: SessionUser, templateId: string) {
  const template = await getTemplate(templateId);
  if (template.companyId !== null && template.companyId !== user.companyId) {
    throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
  }
  if (!template.isActive) throw new ApiError("TEMPLATE_INACTIVE", "Template nonaktif tidak dapat dipakai.", 409);
  const variables = await db.select().from(documentTemplateVariables)
    .where(eq(documentTemplateVariables.templateId, templateId))
    .orderBy(asc(documentTemplateVariables.sortOrder));
  return { template, variables };
}

async function saveVersion(user: SessionUser, templateId: string, entry: {
  version: number; name: string; blocks: unknown; docxFileId: string | null;
  variables: TemplateVariableInput[]; note?: string;
}) {
  await db.insert(documentTemplateVersions).values({
    id: newId(), companyId: user.companyId, templateId, version: entry.version, name: entry.name,
    blocks: entry.blocks ?? null, docxFileId: entry.docxFileId, variables: entry.variables,
    note: entry.note ?? null, createdById: user.id,
  });
}

async function assertCodeFree(user: SessionUser, code: string, exceptId?: string, baseCode?: string | null) {
  const systemCodes = new Set<string>(DOCUMENT_TEMPLATES.map((t) => t.code));
  // Varian company boleh memakai kode dasar yang sama (`BAST1_CUSTOM` disarankan,
  // tetapi `baseCode` menyatakan turunan template sistem mana).
  if (!baseCode && systemCodes.has(code) && exceptId !== `tpl-system-${code}`) {
    throw new ApiError("CODE_RESERVED", `Kode ${code} dipakai template sistem. Pilih kode lain atau isi baseCode.`, 409);
  }
  const [duplicate] = await db.select({ id: documentTemplates.id }).from(documentTemplates)
    .where(and(eq(documentTemplates.companyId, user.companyId), eq(documentTemplates.code, code))).limit(1);
  if (duplicate && duplicate.id !== exceptId) {
    throw new ApiError("DUPLICATE_CODE", `Kode template ${code} sudah dipakai company ini.`, 409);
  }
}

/** Unggah berkas .docx template (privat, divalidasi magic bytes + tag). */
export async function uploadTemplateDocx(user: SessionUser, file: { buffer: Buffer; fileName: string }) {
  assertTemplateManage(user);
  if (file.buffer.length > DOCX_MAX_BYTES) {
    throw new ApiError("FILE_TOO_LARGE", "Berkas template maksimal 10 MB.", 413);
  }
  if (!isDocxBuffer(file.buffer)) {
    throw new ApiError("INVALID_DOCX", "Berkas bukan dokumen Word (.docx) yang sah.", 422);
  }
  let tags: string[] = [];
  try {
    tags = extractDocxTags(file.buffer);
  } catch {
    throw new ApiError("INVALID_DOCX", "Struktur .docx tidak dapat dibaca. Simpan ulang dari Word.", 422);
  }
  const fileId = newId();
  const storageKey = `private/templates/${user.companyId}/${fileId}.docx`;
  const stored = await putObject(file.buffer, storageKey, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const { createHash } = await import("node:crypto");
  try {
    await db.insert(fileObjects).values({
      id: fileId, storageKey, fileName: file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "template.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: file.buffer.length, sha256: createHash("sha256").update(file.buffer).digest("hex"),
      contentBase64: null, storageProvider: stored.storageProvider, storageBucket: stored.storageBucket,
      uploadedById: user.id,
    });
  } catch (error) {
    await removeObject(storageKey, stored.storageProvider, stored.storageBucket);
    throw error;
  }
  return { fileId, tags, sizeBytes: file.buffer.length };
}

export async function createTemplate(user: SessionUser, input: TemplateInput) {
  assertTemplateManage(user);
  await assertCodeFree(user, input.code, undefined, input.baseCode);
  if (input.docxFileId) await assertOwnedDocx(user, input.docxFileId);
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(documentTemplates).values({
      id, companyId: user.companyId, code: input.code, name: input.name.trim(),
      description: input.description ?? null, category: input.category, baseCode: input.baseCode ?? null,
      version: 1, kind: input.kind, blocks: input.blocks ?? null, docxFileId: input.docxFileId ?? null,
      signatureParties: input.signatureParties ?? null, isActive: input.isActive,
      isSystem: false, createdById: user.id, updatedById: user.id,
    });
    await replaceVariables(user, id, input.variables);
  });
  await saveVersion(user, id, {
    version: 1, name: input.name, blocks: input.blocks ?? null, docxFileId: input.docxFileId ?? null,
    variables: input.variables, note: "Versi awal",
  });
  await audit({
    actorId: user.id, objectType: "DOCUMENT_TEMPLATE", objectId: id, action: "CREATED",
    changes: [{ field: "code", old: null, new: input.code }, { field: "kind", old: null, new: input.kind }],
  });
  return { id, code: input.code, version: 1 };
}

async function assertOwnedDocx(user: SessionUser, fileId: string) {
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, fileId)).limit(1);
  if (!file) throw new ApiError("FILE_NOT_FOUND", "Berkas template tidak ditemukan.", 404);
  if (file.uploadedById !== user.id && user.role !== "ADMIN") {
    throw new ApiError("FORBIDDEN", "Berkas template milik pengguna lain.", 403);
  }
  return file;
}

async function replaceVariables(user: SessionUser, templateId: string, variables: TemplateVariableInput[]) {
  await db.delete(documentTemplateVariables).where(eq(documentTemplateVariables.templateId, templateId));
  if (!variables.length) return;
  await db.insert(documentTemplateVariables).values(variables.map((variable, index) => ({
    id: newId(), companyId: user.companyId, templateId, tag: variable.tag, label: variable.label,
    varType: variable.varType, source: variable.source, sampleValue: variable.sampleValue ?? null,
    isRequired: variable.isRequired, sortOrder: index,
  })));
}

export async function updateTemplate(user: SessionUser, templateId: string, input: TemplateInput) {
  assertTemplateManage(user);
  const existing = await getTemplate(templateId);
  if (existing.isSystem || existing.companyId === null) {
    throw new ApiError(SYSTEM_TEMPLATE_READONLY, "Template sistem tidak dapat diubah. Duplikat menjadi template company dahulu.", 409);
  }
  if (existing.companyId !== user.companyId) throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
  await assertCodeFree(user, input.code, templateId, input.baseCode);
  if (input.docxFileId && input.docxFileId !== existing.docxFileId) await assertOwnedDocx(user, input.docxFileId);

  // Perubahan isi (blok/DOCX/nama) menaikkan versi; perubahan aktif/nonaktif tidak.
  const contentChanged = input.kind !== existing.kind
    || input.name !== existing.name
    || JSON.stringify(input.blocks ?? null) !== JSON.stringify(existing.blocks ?? null)
    || (input.docxFileId ?? null) !== existing.docxFileId;
  const nextVersion = contentChanged ? existing.version + 1 : existing.version;

  await db.transaction(async (tx) => {
    await tx.update(documentTemplates).set({
      code: input.code, name: input.name.trim(), description: input.description ?? null,
      category: input.category, baseCode: input.baseCode ?? null, version: nextVersion,
      kind: input.kind, blocks: input.blocks ?? null, docxFileId: input.docxFileId ?? null,
      signatureParties: input.signatureParties ?? null, isActive: input.isActive,
      updatedById: user.id, updatedAt: new Date(),
    }).where(eq(documentTemplates.id, templateId));
    await replaceVariables(user, templateId, input.variables);
  });
  if (contentChanged) {
    await saveVersion(user, templateId, {
      version: nextVersion, name: input.name, blocks: input.blocks ?? null,
      docxFileId: input.docxFileId ?? null, variables: input.variables, note: "Perubahan isi",
    });
  }
  await audit({
    actorId: user.id, objectType: "DOCUMENT_TEMPLATE", objectId: templateId, action: contentChanged ? "VERSIONED" : "UPDATED",
    changes: [
      { field: "version", old: existing.version, new: nextVersion },
      { field: "isActive", old: existing.isActive, new: input.isActive },
    ],
  });
  return { id: templateId, version: nextVersion, contentChanged };
}

/** Duplikat template (sistem atau company) menjadi varian company yang bisa diedit. */
export async function duplicateTemplate(user: SessionUser, templateId: string, overrides: { code?: string; name?: string } = {}) {
  assertTemplateManage(user);
  const source = await getTemplate(templateId);
  if (source.companyId !== null && source.companyId !== user.companyId) {
    throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
  }
  const variables = await db.select().from(documentTemplateVariables).where(eq(documentTemplateVariables.templateId, templateId));
  const code = (overrides.code ?? `${source.code}_CUSTOM`).toUpperCase().slice(0, 40);
  const input: TemplateInput = {
    code, name: overrides.name ?? `${source.name} (company)`,
    description: source.description, category: source.category, kind: source.kind as "BLOCKS" | "DOCX",
    blocks: (source.blocks ?? undefined) as Record<string, unknown>[] | undefined,
    docxFileId: source.docxFileId, signatureParties: (source.signatureParties ?? undefined) as TemplateInput["signatureParties"],
    isActive: true, baseCode: source.code,
    variables: variables.length
      ? variables.map((v) => ({
        tag: v.tag, label: v.label, varType: v.varType as TemplateVariableInput["varType"],
        source: v.source as TemplateVariableInput["source"], sampleValue: v.sampleValue,
        isRequired: v.isRequired,
      }))
      : DEFAULT_TEMPLATE_VARIABLES.map((v) => ({ ...v })),
  };
  const created = await createTemplate(user, input);
  await audit({
    actorId: user.id, objectType: "DOCUMENT_TEMPLATE", objectId: created.id, action: "DUPLICATED",
    changes: [{ field: "sourceTemplateId", old: null, new: templateId }],
  });
  return created;
}

export async function deactivateTemplate(user: SessionUser, templateId: string, reason: unknown) {
  assertTemplateManage(user);
  const note = requiredReason(reason, "Alasan menonaktifkan template");
  const existing = await getTemplate(templateId);
  if (existing.isSystem || existing.companyId === null) {
    throw new ApiError(SYSTEM_TEMPLATE_READONLY, "Template sistem tidak dapat dinonaktifkan.", 409);
  }
  if (existing.companyId !== user.companyId) throw new ApiError("NOT_FOUND", "Template dokumen tidak ditemukan.", 404);
  await db.update(documentTemplates).set({ isActive: false, updatedById: user.id, updatedAt: new Date() })
    .where(eq(documentTemplates.id, templateId));
  await audit({
    actorId: user.id, objectType: "DOCUMENT_TEMPLATE", objectId: templateId, action: "DEACTIVATED",
    reason: note, changes: [{ field: "isActive", old: true, new: false }],
  });
  return { id: templateId, isActive: false };
}

export async function listTemplateVersions(templateId: string) {
  await getTemplate(templateId);
  const rows = await db.select().from(documentTemplateVersions)
    .where(eq(documentTemplateVersions.templateId, templateId))
    .orderBy(asc(documentTemplateVersions.version));
  return rows.map((row) => ({
    id: row.id, version: row.version, name: row.name, note: row.note,
    hasDocx: !!row.docxFileId, variableCount: ((row.variables ?? []) as unknown[]).length,
    createdAt: row.createdAt, createdById: row.createdById,
  }));
}

/** Baca berkas DOCX template untuk preview/unduh (lewat signed URL file_objects). */
export async function readTemplateDocx(fileId: string) {
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, fileId)).limit(1);
  if (!file) throw new ApiError("NOT_FOUND", "Berkas template tidak ditemukan.", 404);
  return { file: file as StoredFile, buffer: await getObjectBuffer(file as StoredFile) };
}
