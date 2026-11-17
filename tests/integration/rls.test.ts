import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integrasi RLS. Sengaja DI-SKIP default karena butuh database nyata.
 * Jalankan:  EPC_RLS_TEST=1 npm test
 * (atau cukup `npm run db:verify` yang melakukan pemeriksaan lebih lengkap).
 */
const enabled = process.env.EPC_RLS_TEST === "1" && !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("isolasi RLS antar company", () => {
  let db: any;
  let companyA = "", companyB = "", codeA = "", codeB = "";
  let ClientCtor: typeof import("pg").Client;

  beforeAll(async () => {
    ({ Client: ClientCtor } = await import("pg"));
    db = new ClientCtor({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const suffix = randomBytes(4).toString("hex");
    codeA = `CA-${suffix}`; codeB = `CB-${suffix}`;
    await db.query("BEGIN");
    companyA = (await db.query("INSERT INTO companies (slug,name,legal_name) VALUES ($1,$2,$2) RETURNING id", [`rls-a-${suffix}`, "A"])).rows[0].id;
    companyB = (await db.query("INSERT INTO companies (slug,name,legal_name) VALUES ($1,$2,$2) RETURNING id", [`rls-b-${suffix}`, "B"])).rows[0].id;
    await db.query("SELECT set_config('app.current_company_id',$1,false)", [companyA]);
    await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry) VALUES ($1,$2,$2,$2,'test')", [`cl-${suffix}-a`, codeA]);
    await db.query("SELECT set_config('app.current_company_id',$1,false)", [companyB]);
    await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry) VALUES ($1,$2,$2,$2,'test')", [`cl-${suffix}-b`, codeB]);
    await db.query("COMMIT");
    await db.query("SELECT set_config('app.current_company_id','',false)");
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.current_company_id',$1,true)", [companyA]);
      await db.query("DELETE FROM clients WHERE code=$1", [codeA]);
      await db.query("SELECT set_config('app.current_company_id',$1,true)", [companyB]);
      await db.query("DELETE FROM clients WHERE code=$1", [codeB]);
      await db.query("COMMIT");
    } catch { /* best effort */ }
    await db.query("SELECT set_config('app.current_company_id','',false)").catch(() => undefined);
    await db.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", [[companyA, companyB]]).catch(() => undefined);
    await db.end();
  });

  it("company A hanya melihat kliennya sendiri", async () => {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.current_company_id',$1,true)", [companyA]);
    const rows = await db.query("SELECT code FROM clients WHERE code = ANY($1::text[])", [[codeA, codeB]]);
    await db.query("ROLLBACK");
    expect(rows.rows.map((r: { code: string }) => r.code)).toEqual([codeA]);
  });

  it("query tanpa scope mengembalikan nol baris (fail-closed)", async () => {
    const rows = await db.query("SELECT code FROM clients WHERE code = ANY($1::text[])", [[codeA, codeB]]);
    expect(rows.rowCount).toBe(0);
  });

  it("insert lintas company ditolak", async () => {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.current_company_id',$1,true)", [companyA]);
    let rejected = false;
    try {
      await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ($1,$2,$2,$2,'test',$3)",
        [`cl-x-${codeA}`, `CX-${codeA}`, companyB]);
    } catch { rejected = true; }
    await db.query("ROLLBACK");
    expect(rejected).toBe(true);
  });
});
