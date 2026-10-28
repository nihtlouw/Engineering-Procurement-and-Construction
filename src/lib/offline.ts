"use client";
import { api } from "@/lib/client";

export type OfflineExpense = { clientUuid: string; merchant: string; total: string; payload: Record<string, unknown>; send: boolean; status: "QUEUED" | "SYNCING" | "SYNCED" | "ERROR"; retries: number; createdAt: string; error?: string };
const KEY = "ardaya-expense-outbox-v1";
const emit = () => window.dispatchEvent(new Event("epc-outbox-changed"));
export function readOutbox(): OfflineExpense[] { if (typeof window === "undefined") return []; try { return JSON.parse(localStorage.getItem(KEY) || "[]") as OfflineExpense[]; } catch { return []; } }
function write(items: OfflineExpense[]) { localStorage.setItem(KEY, JSON.stringify(items)); emit(); }
export function queueExpense(item: Omit<OfflineExpense, "status" | "retries" | "createdAt">) { const all = readOutbox().filter((e) => e.clientUuid !== item.clientUuid); all.unshift({ ...item, status: "QUEUED", retries: 0, createdAt: new Date().toISOString() }); write(all); }
export async function syncExpense(clientUuid: string) {
  const all = readOutbox(); const item = all.find((e) => e.clientUuid === clientUuid); if (!item) return;
  item.status = "SYNCING"; item.retries += 1; item.error = undefined; write(all);
  try {
    const created = await api<{ id: string; code: string; idempotent?: boolean }>("/api/expenses", { method: "POST", body: JSON.stringify(item.payload) });
    if (item.send && !created.idempotent) await api(`/api/expenses/${created.id}/action`, { method: "POST", body: JSON.stringify({ action: "SUBMIT" }) });
    const latest = readOutbox(); const current = latest.find((e) => e.clientUuid === clientUuid); if (current) { current.status = "SYNCED"; current.error = undefined; write(latest); }
    return created;
  } catch (error) {
    const latest = readOutbox(); const current = latest.find((e) => e.clientUuid === clientUuid); if (current) { current.status = "ERROR"; current.error = error instanceof Error ? error.message : "Sinkronisasi gagal"; write(latest); } throw error;
  }
}
export function clearSynced() { write(readOutbox().filter((e) => e.status !== "SYNCED")); }
