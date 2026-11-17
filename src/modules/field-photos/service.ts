import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, documentPhotoLinks, fieldPhotos, fileObjects, projects, users,
} from "@/db/schema";
import { ApiError, assertPermission, hasPermission } from "@/lib/auth";
import type { SessionUser } from "@/lib/domain";
import { parsePhotoRows, type DocumentPhotoRef } from "@/lib/document-templates";
import { formatDate } from "@/lib/format";
import { newId, requireProject } from "@/lib/server-services";
import { filterFieldPhotos } from "@/modules/field-photos/filter";
import { compressPhoto, validatePhotoBuffer } from "@/modules/field-photos/image";
import { getFileUrl, putPhotoObject, removePhotoObject, STORAGE_URL_TTL_SECONDS, type StoredFile } from "@/modules/field-photos/storage";
import { PHOTO_CATEGORY_ORDER, type FieldPhotoFilter, type FieldPhotoUploadInput } from "@/modules/field-photos/validation";

type FileRow = typeof fileObjects.$inferSelect;
type PhotoRow = typeof fieldPhotos.$inferSelect;

function toStoredFile(file: FileRow): StoredFile {
  return {
    id: file.id,
    storageProvider: file.storageProvider,
    storageBucket: file.storageBucket,
    storageKey: file.storageKey,
    contentBase64: file.contentBase64,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    fileName: file.fileName,
  };
}

function buildCaption(photo: PhotoRow) {
  const parts = [formatDate(photo.capturedAt), photo.locationLabel, photo.description]
    .filter((v): v is string => !!v && v !== "—");
  return parts.join(" · ").slice(0, 180) || "Foto lapangan";
}

function photoRef(photo: PhotoRow, file: FileRow): DocumentPhotoRef {
  return {
    id: photo.id,
    fileId: file.id,
    category: photo.category,
    caption: buildCaption(photo),
    capturedAt: photo.capturedAt,
  };
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(tx: DbTransaction, input: {
  actorId: string; objectId: string; projectId: string; action: string;
  changes?: { field: string; old: unknown; new: unknown }[];
}) {
  await tx.insert(activityLogs).values({
    id: newId(), actorId: input.actorId, objectType: "FIELD_PHOTO", objectId: input.objectId,
    projectId: input.projectId, action: input.action, changes: input.changes ?? null,
  });
}

export async function createFieldPhoto(
  user: SessionUser,
  input: FieldPhotoUploadInput,
  upload: { fileName: string; mimeType: string; buffer: Buffer },
) {
  assertPermission(user, "document.upload");
  await requireProject(user, input.projectId, "document.upload");
  const sourceMime = validatePhotoBuffer(upload.buffer, upload.mimeType);
  const normalized = await compressPhoto(upload.buffer);
  const fileId = newId();
  const storageKey = `private/field-photos/${input.projectId}/${fileId}.jpg`;
  const stored = await putPhotoObject(normalized.buffer, storageKey);
  const baseName = upload.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "foto";
  const fileName = `${baseName}.jpg`;

  const id = newId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(fileObjects).values({
        id: fileId,
        storageKey,
        fileName,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        sha256: normalized.sha256,
        contentBase64: null,
        storageProvider: stored.storageProvider,
        storageBucket: stored.storageBucket,
        width: normalized.width,
        height: normalized.height,
        originalSizeBytes: normalized.originalSizeBytes,
        uploadedById: user.id,
      });
      await tx.insert(fieldPhotos).values({
        id,
        projectId: input.projectId,
        fileId,
        category: input.category,
        capturedAt: input.capturedAt,
        description: input.description || null,
        locationLabel: input.locationLabel || null,
        isSelectedForReport: false,
        sortOrder: 0,
        uploadedById: user.id,
      });
      await audit(tx, {
        actorId: user.id, objectId: id, projectId: input.projectId, action: "UPLOADED",
        changes: [
          { field: "category", old: null, new: input.category },
          { field: "sourceMime", old: null, new: sourceMime },
          { field: "sizeBytes", old: normalized.originalSizeBytes, new: normalized.sizeBytes },
        ],
      });
    });
  } catch (error) {
    await removePhotoObject(storageKey, stored.storageProvider, stored.storageBucket);
    throw error;
  }
  return {
    id, fileId, fileName, category: input.category, capturedAt: input.capturedAt,
    sizeBytes: normalized.sizeBytes, width: normalized.width, height: normalized.height,
    sha256: normalized.sha256, storageProvider: stored.storageProvider,
  };
}

/** Dipakai workspace DTO: hanya project yang boleh dilihat user. */
export async function listWorkspaceFieldPhotos(
  user: SessionUser,
  projectIds: string[],
  expires = Math.floor(Date.now() / 1000) + STORAGE_URL_TTL_SECONDS,
): Promise<Record<string, unknown>[]> {
  if (!projectIds.length || !hasPermission(user, "document.view")) return [];
  const rows = await db.select({
    photo: fieldPhotos, file: fileObjects, uploaderName: users.name, projectCode: projects.code,
  })
    .from(fieldPhotos)
    .innerJoin(fileObjects, eq(fileObjects.id, fieldPhotos.fileId))
    .innerJoin(users, eq(users.id, fieldPhotos.uploadedById))
    .innerJoin(projects, eq(projects.id, fieldPhotos.projectId))
    .where(inArray(fieldPhotos.projectId, projectIds));
  return Promise.all(rows.map(async ({ photo, file, uploaderName, projectCode }) => ({
    id: photo.id,
    projectId: photo.projectId,
    projectCode,
    fileId: file.id,
    category: photo.category,
    capturedAt: photo.capturedAt,
    description: photo.description,
    locationLabel: photo.locationLabel,
    isSelectedForReport: photo.isSelectedForReport,
    sortOrder: photo.sortOrder,
    width: file.width,
    height: file.height,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    uploadedById: photo.uploadedById,
    uploadedByName: uploaderName,
    createdAt: photo.createdAt.toISOString(),
    fileUrl: await getFileUrl(toStoredFile(file), expires),
  })));
}

export async function listFieldPhotos(user: SessionUser, filters: FieldPhotoFilter) {
  await requireProject(user, filters.projectId, "document.view", true);
  // CLIENT_VIEWER hanya melihat foto yang diproyeksikan ke laporan, bukan seluruh galeri.
  const effective: FieldPhotoFilter = { ...filters, selectedOnly: filters.selectedOnly || user.role === "CLIENT_VIEWER" };
  const rows = await listWorkspaceFieldPhotos(user, [filters.projectId]);
  return filterFieldPhotos(rows as (Record<string, unknown> & {
    category: string; capturedAt: string; isSelectedForReport: boolean;
  })[], effective);
}

export async function setFieldPhotoSelection(user: SessionUser, id: string, selected: boolean) {
  const [photo] = await db.select().from(fieldPhotos).where(eq(fieldPhotos.id, id)).limit(1);
  if (!photo) throw new ApiError("NOT_FOUND", "Foto lapangan tidak ditemukan.", 404);
  await requireProject(user, photo.projectId, "document.upload");
  await db.transaction(async (tx) => {
    await tx.update(fieldPhotos).set({ isSelectedForReport: selected }).where(eq(fieldPhotos.id, id));
    await audit(tx, {
      actorId: user.id, objectId: id, projectId: photo.projectId,
      action: selected ? "SELECTED_FOR_REPORT" : "REMOVED_FROM_REPORT",
      changes: [{ field: "isSelectedForReport", old: photo.isSelectedForReport, new: selected }],
    });
  });
  return { id, isSelectedForReport: selected };
}

export async function getSelectedPhotoRefs(projectId: string): Promise<DocumentPhotoRef[]> {
  const rows = await db.select({ photo: fieldPhotos, file: fileObjects })
    .from(fieldPhotos)
    .innerJoin(fileObjects, eq(fileObjects.id, fieldPhotos.fileId))
    .where(and(eq(fieldPhotos.projectId, projectId), eq(fieldPhotos.isSelectedForReport, true)));
  return rows.map(({ photo, file }) => photoRef(photo, file))
    .sort((a, b) => (PHOTO_CATEGORY_ORDER[a.category] ?? 99) - (PHOTO_CATEGORY_ORDER[b.category] ?? 99)
      || (a.capturedAt ?? "").localeCompare(b.capturedAt ?? ""));
}

export async function attachSelectedPhotosToDocument(
  user: SessionUser,
  documentId: string,
  refs: DocumentPhotoRef[],
  tx?: DbTransaction,
) {
  if (!refs.length) return;
  const executor = tx ?? db;
  await executor.insert(documentPhotoLinks).values(refs.map((ref, index) => ({
    id: newId(),
    documentId,
    fieldPhotoId: ref.id,
    sortOrder: index,
    selectedById: user.id,
  }))).onConflictDoNothing();
}

export async function copyDocumentPhotoLinksForRevision(
  tx: DbTransaction,
  oldDocumentId: string,
  newDocumentId: string,
  userId: string,
) {
  const links = await tx.select().from(documentPhotoLinks)
    .where(eq(documentPhotoLinks.documentId, oldDocumentId));
  if (!links.length) return;
  await tx.insert(documentPhotoLinks).values(links.map((link) => ({
    id: newId(),
    documentId: newDocumentId,
    fieldPhotoId: link.fieldPhotoId,
    sortOrder: link.sortOrder,
    selectedById: userId,
  })));
}

export async function getDocumentPhotoBundle(
  documentId: string,
  snapshotRaw?: string | null,
): Promise<{
  refs: DocumentPhotoRef[];
  sources: Record<string, StoredFile>;
}> {
  const rows = await db.select({ link: documentPhotoLinks, photo: fieldPhotos, file: fileObjects })
    .from(documentPhotoLinks)
    .innerJoin(fieldPhotos, eq(fieldPhotos.id, documentPhotoLinks.fieldPhotoId))
    .innerJoin(fileObjects, eq(fileObjects.id, fieldPhotos.fileId))
    .where(eq(documentPhotoLinks.documentId, documentId))
    .orderBy(asc(documentPhotoLinks.sortOrder));
  let refs = rows.map(({ photo, file }) => photoRef(photo, file));
  let files = rows.map(({ file }) => file);
  // Fallback dokumen lama/revisi sebelum link-table ada: memakai merge snapshot.
  if (!refs.length) {
    const fromSnapshot = parsePhotoRows(snapshotRaw);
    if (fromSnapshot.length) {
      const fileRows = await db.select().from(fileObjects)
        .where(inArray(fileObjects.id, fromSnapshot.map((ref) => ref.fileId)));
      refs = fromSnapshot;
      files = fileRows;
    }
  }
  const sources: Record<string, StoredFile> = {};
  for (const file of files) sources[file.id] = toStoredFile(file);
  return { refs, sources };
}
