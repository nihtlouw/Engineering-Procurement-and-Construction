import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Uji migrasi dari database kosong TANPA membutuhkan server Postgres eksternal.
 * PGlite = Postgres 17 (WASM) in-process. Baseline di bawah meniru 28 tabel
 * pra-S1 sekedar untuk mengeksekusi ALTER/CREATE POLICY; bukan pengganti
 * `npm run db:verify` pada database nyata.
 */
const TABLES = [
  "clients", "sites", "opportunities", "projects", "project_members", "contract_terms",
  "budget_versions", "budget_lines", "purchase_records", "file_objects", "expenses", "expense_lines",
  "expense_settlements", "customer_invoices", "customer_payments", "schedule_items", "progress_updates",
  "change_orders", "punch_items", "handover_items", "documents", "activity_logs", "notifications",
  "company_settings",
];

const EXTRA: Record<string, string> = {
  clients: ", code text, legal_name text, display_name text, industry text",
  budget_versions: ", project_id text, type text, version_no int, is_active_baseline boolean default false",
  budget_lines: ", budget_version_id text",
  expenses: ", approval_status text, created_at timestamptz default now()",
  expense_lines: ", expense_id text",
  documents: ", project_id text",
  schedule_items: ", project_id text",
  progress_updates: ", project_id text, report_date date",
  notifications: ", user_id text",
  customer_payments: ", invoice_id text",
  activity_logs: ", object_type text, object_id text, action text, actor_id text, changes jsonb, reason text, created_at timestamptz default now()",
  projects: ", stage text",
};

let db: PGlite;
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];

beforeAll(async () => {
  db = new PGlite();
  let ddl = `CREATE TABLE users (id text primary key, role text, email text, is_active boolean default true);
CREATE TABLE sessions (id text primary key, user_id text, expires_at timestamptz);
CREATE TABLE cost_categories (id text primary key, code text);
CREATE TABLE units (id text primary key, code text);
`;
  for (const t of TABLES) ddl += `CREATE TABLE ${t} (id text primary key${EXTRA[t] ?? ""});\n`;
  ddl += `INSERT INTO users (id,role,email) VALUES ('u-admin','ADMIN','a@x.id');
INSERT INTO sessions (id,user_id,expires_at) VALUES ('s1','u-admin',now()+interval '1 day');
INSERT INTO clients (id,code) VALUES ('c1','C1');
INSERT INTO projects (id,stage) VALUES ('p1','IN_PROGRESS');
`;
  await db.exec(ddl);

  const dir = path.resolve(process.cwd(), "drizzle");
  for (const file of ["0000_tenant_foundation.sql", "0001_rls_policies.sql"]) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  // PGlite default = superuser (BYPASSRLS). Neon/Supabase memakai role non-superuser.
  await db.exec(`CREATE ROLE epc_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO epc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO epc_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO epc_app;
SET ROLE epc_app;`);
});

afterAll(async () => { await db?.close(); });

describe("migrasi S1 dari database kosong", () => {
  it("membuat company default dan mem-backfill data existing tanpa menghapusnya", async () => {
    const company = await rows("SELECT id FROM companies WHERE slug='default'");
    expect(company).toHaveLength(1);
    const client = await rows("SELECT company_id FROM clients WHERE id='c1'");
    expect(client[0].company_id).toBe(company[0].id);
    const project = await rows("SELECT company_id FROM projects WHERE id='p1'");
    expect(project[0].company_id).toBe(company[0].id);
  });

  it("membuat keanggotaan untuk user lama", async () => {
    const m = await rows("SELECT company_role, status FROM memberships WHERE user_id='u-admin'");
    expect(m[0]).toMatchObject({ company_role: "ADMIN", status: "ACTIVE" });
  });

  it("mengaktifkan ENABLE + FORCE RLS pada 24 tabel bisnis", async () => {
    const list = TABLES.map((t) => `'${t}'`).join(",");
    const r = await rows(`SELECT relname FROM pg_class WHERE relname = ANY(ARRAY[${list}]) AND relrowsecurity AND relforcerowsecurity`);
    expect(r).toHaveLength(24);
  });

  it("membuat 96 policy (4 aksi × 24 tabel)", async () => {
    const r = await rows("SELECT count(*)::int AS n FROM pg_policy");
    expect(r[0].n).toBe(96);
  });

  it("menyediakan view audit_logs dan trigger immutability", async () => {
    const v = await rows("SELECT count(*)::int AS n FROM pg_views WHERE viewname='audit_logs'");
    expect(v[0].n).toBe(1);
    const t = await rows("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='activity_logs_immutable'");
    expect(t[0].n).toBe(1);
  });

  it("mengisolasi SELECT antar company dan menolak tanpa scope", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await db.exec(`SELECT set_config('app.current_company_id','${a.id}',false);`);

    await db.exec(`INSERT INTO companies (slug,name,legal_name) VALUES ('other','Other','Other');`);
    const [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    await db.exec(`SELECT set_config('app.current_company_id','${other.id}',false);`);
    await db.exec(`INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ('c2','C2','X','X','X','${other.id}');`);

    await db.exec(`SELECT set_config('app.current_company_id','${a.id}',false);`);
    const visible = await rows("SELECT id FROM clients");
    expect(visible.map((r) => r.id)).toEqual(["c1"]);

    await db.exec("SELECT set_config('app.current_company_id','',false);");
    const unscoped = await rows("SELECT id FROM clients");
    expect(unscoped).toHaveLength(0);
  });

  it("menolak INSERT untuk company lain", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    const [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    await db.exec(`SELECT set_config('app.current_company_id','${a.id}',false);`);
    await expect(db.exec(`INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ('c3','C3','X','X','X','${other.id}');`))
      .rejects.toThrow();
  });
});
