"use client";

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
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
