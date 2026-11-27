"use client";

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  // FormData wajib dibiarkan tanpa Content-Type agar browser menulis boundary.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    headers: isFormData ? { ...options.headers } : { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({ message: "Respons server tidak valid." }));
  if (!response.ok) throw new Error(body.message || `Permintaan gagal (${response.status}).`);
  return body.data as T;
}
export const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d"); if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .8));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file;
}
export async function uploadFieldPhoto(
  file: File,
  meta: { projectId: string; category: string; capturedAt: string; description?: string; locationLabel?: string },
) {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(meta)) if (value) form.set(key, value);
  const response = await fetch("/api/field-photos", { method: "POST", body: form });
  const body = await response.json().catch(() => ({ message: "Respons server tidak valid." }));
  if (!response.ok) throw new Error(body.message || `Unggahan foto gagal (${response.status}).`);
  return body.data as {
    id: string; fileId: string; category: string; capturedAt: string;
    sizeBytes: number; width: number; height: number; sha256: string; storageProvider: string;
  };
}

export async function uploadFile(file: File) {
  const compressed = await compressImage(file); const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(compressed); });
  return api<{ id: string; fileName: string; sizeBytes: number; duplicateReceipt: boolean }>("/api/files", { method: "POST", body: JSON.stringify({ fileName: compressed.name, mimeType: compressed.type || "application/octet-stream", contentBase64: base64 }) });
}

/* -------------------------------------------------------------------------- */
/* Master data (tahap 2)                                                      */
/* -------------------------------------------------------------------------- */

export type MasterDataOptions = {
  users: { id: string; name: string; title: string; role: string; email?: string }[];
  clients: { id: string; code: string; displayName: string; legalName: string }[];
  sites: { id: string; clientId: string; name: string; address: string | null }[];
  projectRoles: string[];
  meta: { defaultPpnRate: string; today: string };
};

/** Opsi form wizard proyek. Dipanggil saat modal dibuka, bukan saat SSR. */
export const fetchMasterDataOptions = () => api<MasterDataOptions>("/api/master-data/options");

export type ProjectMemberView = {
  id: string; projectId: string; userId: string; projectRole: string;
  name: string; email: string; title: string;
};

export const addProjectMember = (projectId: string, body: { userId: string; projectRole: string }) =>
  api<{ id: string }>(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify(body) });

export const removeProjectMember = (projectId: string, memberId: string) =>
  api<{ id: string }>(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" });

export const updateProject = (projectId: string, body: Record<string, unknown>) =>
  api<{ id: string; changed: number }>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(body) });

export const createClientRecord = (body: Record<string, unknown>) =>
  api<{ id: string; code: string }>("/api/clients", { method: "POST", body: JSON.stringify(body) });

export const updateClientRecord = (clientId: string, body: Record<string, unknown>) =>
  api<{ id: string; changed: number }>(`/api/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(body) });

export const archiveClientRecord = (clientId: string) =>
  api<{ id: string }>(`/api/clients/${clientId}`, { method: "POST", body: JSON.stringify({ action: "ARCHIVE" }) });

export const createSiteRecord = (body: Record<string, unknown>) =>
  api<{ id: string }>("/api/sites", { method: "POST", body: JSON.stringify(body) });

export const updateSiteRecord = (siteId: string, body: Record<string, unknown>) =>
  api<{ id: string; changed: number }>(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(body) });

export const createProjectRecord = (body: Record<string, unknown>) =>
  api<{ id: string; code: string; stage: string; members: number }>("/api/projects", { method: "POST", body: JSON.stringify(body) });

/* -------------------------------------------------------------------------- */
/* Tahap 3 · termin kontrak & katalog biaya                                   */
/* -------------------------------------------------------------------------- */

export type ContractTermView = {
  id: string; projectId: string; type: string; name: string; percent: string | null;
  amount: string; trigger: string | null; targetDate: string | null; sortOrder: number;
  invoicedAmount: string; status: string; isAutoAmount: boolean; notes: string | null;
  invoiceCount: number;
};

export type ContractTermPayload = {
  id?: string | null; type: string; name: string; percent?: string | null;
  amount?: string | null; trigger?: string | null; targetDate?: string | null; notes?: string | null;
};

export const fetchContractTerms = (projectId: string) =>
  api<ContractTermView[]>(`/api/projects/${projectId}/terms`);

export const saveContractTerms = (projectId: string, terms: ContractTermPayload[]) =>
  api<{ count: number; removed: number; changed: number; totalPercent: number }>(
    `/api/projects/${projectId}/terms`,
    { method: "PUT", body: JSON.stringify({ terms }) },
  );

export const closeContractTerm = (projectId: string, termId: string, reason: string) =>
  api<{ id: string; status: string; changed: boolean }>(
    `/api/projects/${projectId}/terms/${termId}`,
    { method: "POST", body: JSON.stringify({ action: "CLOSE", reason }) },
  );

export type CatalogCategory = {
  id: string; companyId: string | null; code: string; name: string;
  isOverhead: boolean; isActive: boolean; shared: boolean; used: boolean;
};

export type CatalogUnit = { id: string; companyId: string | null; code: string; name: string; shared: boolean; used: boolean };

export const fetchCatalog = () => api<{ categories: CatalogCategory[]; units: CatalogUnit[] }>("/api/catalog/categories");

export const createCostCategory = (body: Record<string, unknown>) =>
  api<{ id: string; code: string }>("/api/catalog/categories", { method: "POST", body: JSON.stringify(body) });

export const updateCostCategory = (id: string, body: Record<string, unknown>) =>
  api<{ id: string }>(`/api/catalog/categories/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const createUnitRecord = (body: Record<string, unknown>) =>
  api<{ id: string; code: string }>("/api/catalog/units", { method: "POST", body: JSON.stringify(body) });

export const updateUnitRecord = (id: string, body: Record<string, unknown>) =>
  api<{ id: string }>(`/api/catalog/units/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* -------------------------------------------------------------------------- */
/* Tahap 4 · document generator (template di DB, DOCX, editor blok, arsip)    */
/* -------------------------------------------------------------------------- */

export type TemplateVariableView = {
  id?: string; templateId?: string; tag: string; label: string;
  varType: string; source: string; sampleValue?: string | null; isRequired: boolean; sortOrder?: number;
};

export type DocumentTemplateView = {
  id: string; companyId: string | null; code: string; name: string; description: string | null;
  category: string; baseCode: string | null; version: number; kind: string;
  blocks: Record<string, unknown>[] | null; blockCount: number; docxFileId: string | null; hasDocx: boolean;
  isActive: boolean; isSystem: boolean; shared: boolean; used: boolean;
  variableCount: number; updatedAt: string;
};

export type TemplateCatalog = {
  templates: DocumentTemplateView[];
  variables: TemplateVariableView[];
  defaults: TemplateVariableView[];
};

export const fetchTemplates = () => api<TemplateCatalog>("/api/templates");

export type TemplatePayload = {
  code: string; name: string; description?: string | null; category?: string;
  kind: "BLOCKS" | "DOCX"; blocks?: Record<string, unknown>[]; docxFileId?: string | null;
  signatureParties?: { label: string; name: string; title: string }[];
  isActive?: boolean; variables?: TemplateVariableView[]; baseCode?: string | null;
};

export const createTemplateRecord = (body: TemplatePayload) =>
  api<{ id: string; code: string; version: number }>("/api/templates", { method: "POST", body: JSON.stringify(body) });

export const updateTemplateRecord = (id: string, body: TemplatePayload) =>
  api<{ id: string; version: number; contentChanged: boolean }>(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const duplicateTemplateRecord = (id: string, body: { code?: string; name?: string } = {}) =>
  api<{ id: string; code: string }>(`/api/templates/${id}/action`, {
    method: "POST", body: JSON.stringify({ action: "DUPLICATE", ...body }),
  });

export const deactivateTemplateRecord = (id: string, reason: string) =>
  api<{ id: string; isActive: boolean }>(`/api/templates/${id}/action`, {
    method: "POST", body: JSON.stringify({ action: "DEACTIVATE", reason }),
  });

export const fetchTemplateVersions = (id: string) =>
  api<{ id: string; version: number; name: string; note: string | null; hasDocx: boolean; variableCount: number; createdAt: string }[]>(
    `/api/templates/${id}/versions`,
  );

/** Upload .docx template (bukan gambar): tidak lewat kompresi klien. */
export async function uploadTemplateDocx(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<{ fileId: string; tags: string[]; sizeBytes: number }>("/api/templates/upload", {
    method: "POST", body: form,
  });
}

export const generateDocumentRecord = (body: {
  projectId: string; templateId?: string; templateCode?: string;
  relatedType?: string; relatedId?: string; title?: string;
}) => api<{ id: string; blocks: Record<string, unknown>[]; unresolved: string[]; templateName: string | null }>(
  "/api/documents", { method: "POST", body: JSON.stringify({ action: "CREATE", ...body }) },
);

export const updateDocumentBlocks = (id: string, body: { title?: string; blocks: Record<string, unknown>[] }) =>
  api<{ id: string }>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const actOnDocument = (id: string, action: "FINALIZE" | "REVISE" | "ARCHIVE", reason?: string) =>
  api<{ id: string; status?: string; docNumber?: string; docxFileId?: string | null; fileId?: string }>(
    `/api/documents/${id}/action`, { method: "POST", body: JSON.stringify({ action, reason }) },
  );
