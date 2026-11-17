import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getScope } from "@/shared/db/context";

/**
 * Pool dibuat TANPA melempar di module scope. `next build` meng-import modul ini
 * saat "Collecting page data"; konfigurasi divalidasi pada request pertama lewat
 * assertRuntimeEnv() (lihat src/shared/env.ts). Ini memperbaiki temuan audit #4.
 */
const globalForDb = globalThis as typeof globalThis & {
  __arenaEpcPool?: Pool;
};

const pool =
  globalForDb.__arenaEpcPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

// Tanpa listener ini, satu koneksi yang putus menghentikan proses Node.
pool.on("error", (error) => {
  console.error("[db] idle client error", error.message);
});

if (process.env.NODE_ENV !== "production") globalForDb.__arenaEpcPool = pool;

/** Koneksi polos. HANYA untuk control-plane (lookup sesi/keanggotaan) dan runner migrasi. */
export const baseDb = drizzle(pool);

/**
 * Database yang dipakai seluruh aplikasi.
 *
 * Proxy ini meneruskan setiap operasi ke transaksi berskope company bila handler
 * berjalan di dalam withCompany(). Dengan begitu 24 route lama TIDAK perlu
 * mengubah satu pun baris query mereka untuk patuh pada RLS.
 */
export const db = new Proxy(baseDb, {
  get(_target, prop) {
    const scope = getScope();
    const target = (scope?.tx as typeof baseDb | undefined) ?? baseDb;
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { pool };
