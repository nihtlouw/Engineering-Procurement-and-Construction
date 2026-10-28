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
export async function uploadFile(file: File) {
  const compressed = await compressImage(file); const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(compressed); });
  return api<{ id: string; fileName: string; sizeBytes: number; duplicateReceipt: boolean }>("/api/files", { method: "POST", body: JSON.stringify({ fileName: compressed.name, mimeType: compressed.type || "application/octet-stream", contentBase64: base64 }) });
}
