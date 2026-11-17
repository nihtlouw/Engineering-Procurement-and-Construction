import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionUser } from "@/lib/domain";

/**
 * Konteks request untuk isolasi company.
 *
 * `tx` adalah transaksi Drizzle yang sudah menjalankan
 * `SET LOCAL app.current_company_id`. `SET LOCAL` hanya berlaku di dalam
 * transaksi itulah sebabnya SELURUH handler dibungkus withCompany() dan
 * tidak ada query yang boleh berjalan di luar konteks ini.
 *
 * `db` (src/db/index.ts) adalah Proxy yang membaca konteks ini: bila ada tx,
 * semua `db.select/insert/update/delete` otomatis memakai koneksi berskope;
 * bila tidak ada, query jatuh ke baseDb dan akan DITOLAK oleh RLS (fail-closed).
 */
export type RequestScope = {
  companyId: string;
  user: SessionUser;
  tx: unknown;
};

const storage = new AsyncLocalStorage<RequestScope>();

export const getScope = (): RequestScope | undefined => storage.getStore();

export function runWithScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}
