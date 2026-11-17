import { sql } from "drizzle-orm";
import { baseDb } from "@/db";
import { ApiError, errorResponse, getCurrentUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/domain";
import { runWithScope } from "@/shared/db/context";
import { assertRuntimeEnv } from "@/shared/env";

/**
 * Menjalankan `fn` di dalam SATU transaksi dengan GUC company aktif.
 *
 * `SET LOCAL` (bukan SET) sengaja dipakai: nilainya hilang saat transaksi
 * selesai sehingga koneksi pool tidak pernah "mewarisi" company request
 * sebelumnya. Ini prasyarat keamanan RLS pada connection pool (Opsi A).
 */
export async function withCompany<T>(user: SessionUser, fn: () => Promise<T>): Promise<T> {
  assertRuntimeEnv();
  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_company_id', ${user.companyId}, true)`);
    return runWithScope({ companyId: user.companyId, user, tx }, fn);
  });
}

/**
 * Pembungkus seluruh route yang membutuhkan autentikasi + isolasi company.
 * Perubahan pada route lama cukup 2 baris: rename handler + export wrapper,
 * tanpa mengubah satu pun logika bisnis/query di dalamnya.
 */
export function companyRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      assertRuntimeEnv();
      const user = await getCurrentUser();
      if (!user) throw new ApiError("UNAUTHENTICATED", "Sesi berakhir. Silakan masuk kembali.", 401);
      return await withCompany(user, () => handler(...args));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Route publik (login, health, accept-invite): tidak ada scope company. */
export function publicRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      assertRuntimeEnv();
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
