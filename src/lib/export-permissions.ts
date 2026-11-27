import { ApiError } from "@/lib/auth";
import type { Permission, SessionUser } from "@/lib/domain";

/**
 * Audit SEC-05: ekspor tidak boleh fail-open (200 + file kosong).
 * Setiap jenis ekspor punya izin eksplisit; peran tanpa izin mendapat 403.
 * `budget` dibedakan CLIENT vs INTERNAL supaya margin tidak bocor ke peran
 * yang hanya boleh melihat RAB klien (audit B9).
 */
export const EXPORT_PERMISSIONS: Record<string, Permission[]> = {
  expenses: ["expense.view.project", "expense.view.own"],
  invoices: ["invoice.view"],
  budget: ["budget.client.view", "budget.internal.view"],
};

export const EXPORT_TYPES = Object.keys(EXPORT_PERMISSIONS);

export function assertExportAllowed(user: Pick<SessionUser, "permissions">, type: string): void {
  const allowed = EXPORT_PERMISSIONS[type];
  if (!allowed) throw new ApiError("UNKNOWN_EXPORT", "Jenis ekspor tidak dikenal.", 404);
  if (!allowed.some((permission) => user.permissions.includes(permission))) {
    throw new ApiError("FORBIDDEN", `Izin ${allowed.join(" atau ")} diperlukan untuk mengekspor ${type}.`, 403);
  }
}

/** Tipe RAB yang boleh diekspor oleh pengguna ini (INTERNAL butuh izin internal). */
export function visibleBudgetTypes(user: Pick<SessionUser, "permissions">): ("CLIENT" | "INTERNAL")[] {
  const types: ("CLIENT" | "INTERNAL")[] = [];
  if (user.permissions.includes("budget.client.view")) types.push("CLIENT");
  if (user.permissions.includes("budget.internal.view")) types.push("INTERNAL");
  return types;
}
