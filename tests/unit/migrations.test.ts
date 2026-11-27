import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Uji SELURUH migrasi (0000 → 0005) dari database kosong TANPA server
 * Postgres eksternal. PGlite = Postgres (WASM) in-process. Baseline di bawah
 * meniru skema 28 tabel pra-S1; bukan pengganti `npm run db:verify` pada DB nyata.
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
  projects: `, code text, title text, client_id text, stage text, is_locked boolean default false,
    contract_value numeric(18,2) not null default 0, contract_ppn numeric(18,2),
    retention_pct numeric(5,2) not null default 5, warranty_months integer not null default 12,
    start_date date, target_end_date date, updated_at timestamptz not null default now()`,
  budget_versions: `, project_id text, type text, version_no integer default 1,
    status text not null default 'DRAFT', is_active_baseline boolean not null default false,
    total numeric(18,2) not null default 0, change_order_id text,
    created_by_id text, approved_by_id text, approved_at timestamptz, created_at timestamptz not null default now()`,
  budget_lines: `, budget_version_id text, cost_category_id text, code text, description text,
    quantity numeric(18,4) not null default 0, unit_code text not null default 'Ls',
    unit_amount numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
    contingency_pct numeric(5,2), sort_order integer not null default 0`,
  contract_terms: `, project_id text, type text, name text, percent numeric(5,2),
    amount numeric(18,2), trigger text, target_date date, sort_order integer not null default 0`,
  purchase_records: `, project_id text, supplier_name text, status text not null default 'DRAFT',
    summary text, dpp_amount numeric(18,2) not null default 0, ppn_amount numeric(18,2),
    total_amount numeric(18,2), budget_line_id text, created_by_id text, created_at timestamptz not null default now()`,
  file_objects: `, storage_key text, file_name text, mime_type text, size_bytes integer,
    sha256 text, content_base64 text, uploaded_by_id text, created_at timestamptz not null default now()`,
  expenses: `, code text, approval_status text not null default 'DRAFT', created_at timestamptz not null default now(),
    merchant_name text, receipt_number text, transaction_date date, default_project_id text,
    purchase_record_id text, client_uuid text, dpp_amount numeric(18,2) not null default 0,
    total_amount numeric(18,2) not null default 0, created_by_id text`,
  expense_lines: `, expense_id text, project_id text, cost_category_id text, budget_line_id text,
    description text, quantity numeric(18,4), unit_code text, line_total numeric(18,2),
    scope text, sort_order integer not null default 0`,
  expense_settlements: `, expense_id text, payee_user_id text, amount numeric(18,2), paid_date date, method text`,
  customer_invoices: `, project_id text, contract_term_id text, number text, type text,
    total_amount numeric(18,2) not null default 0, status text not null default 'DRAFT',
    issue_date date, due_date date, dpp_amount numeric(18,2), ppn_amount numeric(18,2),
    created_at timestamptz not null default now()`,
  customer_payments: `, invoice_id text, cash_received_amount numeric(18,2), withholding_tax_amount numeric(18,2), method text`,
  schedule_items: `, project_id text, type text, name text, weight numeric(5,2) not null default 0,
    progress_pct numeric(5,2) not null default 0, status text, planned_end date, sort_order integer not null default 0`,
  progress_updates: `, schedule_item_id text, project_id text, report_date date, created_at timestamptz not null default now(), created_by_id text`,
  change_orders: `, project_id text, code text, title text, reason text, scope_description text,
    status text not null default 'DRAFT', price_impact numeric(18,2) not null default 0,
    cost_impact numeric(18,2) not null default 0, time_impact_days integer not null default 0,
    created_by_id text, created_at timestamptz not null default now()`,
  documents: `, project_id text, template_code text, status text, created_at timestamptz not null default now()`,
  activity_logs: `, object_type text, object_id text, action text, actor_id text, changes jsonb,
    reason text, project_id text, created_at timestamptz not null default now()`,
  notifications: `, user_id text, type text, title text, body text, link text,
    read_at timestamptz, created_at timestamptz not null default now()`,
  company_settings: `, legal_name text, display_name text, default_ppn_rate numeric(5,2) not null default 11,
    allow_split_expense boolean not null default false`,
};

let db: PGlite;
const rows = async (sql: string) => (await db.query(sql)).rows as Record<string, unknown>[];
/** Company 'default' + scope penuh (dipakai banyak describe block). */
const defaultScope = async (permissions = "budget.internal.view,budget.client.view,document.view,invoice.view,invoice.edit,invoice.approve") => {
  const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
  await scope(String(a.id), permissions);
  return String(a.id);
};
const scope = async (companyId: string, permissions = "", userId = "") => {
  await db.exec(`SELECT set_config('app.current_company_id', '${companyId}', false);`);
  await db.exec(`SELECT set_config('app.current_permissions', '${permissions}', false);`);
  // 0005: policy RESTRICTIVE notifikasi memakai GUC user.
  await db.exec(`SELECT set_config('app.current_user_id', '${userId}', false);`);
};

beforeAll(async () => {
  db = new PGlite();
  let ddl = `CREATE TABLE users (id text primary key, role text, email text, name text, title text,
    password_hash text, is_active boolean default true);
CREATE TABLE sessions (id text primary key, user_id text, expires_at timestamptz);
CREATE TABLE cost_categories (id text primary key, code text not null unique, name text not null,
  is_overhead boolean not null default false, is_active boolean not null default true);
CREATE TABLE units (id text primary key, code text not null unique, name text not null);
`;
  for (const t of TABLES) ddl += `CREATE TABLE ${t} (id text primary key${EXTRA[t] ?? ""});\n`;
  ddl += `INSERT INTO users (id,role,email,name,title,password_hash) VALUES ('u-admin','ADMIN','a@x.id','Admin','Direktur','x');
INSERT INTO sessions (id,user_id,expires_at) VALUES ('s1','u-admin',now()+interval '1 day');
INSERT INTO cost_categories (id,code,name) VALUES ('cat-civ','CIV','Sipil');
INSERT INTO units (id,code,name) VALUES ('unit-ls','Ls','Lump sum');
INSERT INTO clients (id,code,legal_name,display_name,industry) VALUES ('c1','C1','PT Satu','Satu','Retail');
INSERT INTO projects (id,code,title,client_id,stage,contract_value,start_date,target_end_date)
  VALUES ('p1','PRJ-1','Proyek Satu','c1','IN_PROGRESS',1000,'2026-01-01','2026-06-30');
INSERT INTO change_orders (id,project_id,code,status,price_impact,cost_impact,created_by_id)
  VALUES ('co-1','p1','CO-2026-001','APPROVED',100,80,'u-admin');
INSERT INTO budget_versions (id,project_id,type,version_no,status,is_active_baseline,total,created_by_id)
  VALUES ('bv-client','p1','CLIENT',1,'BASELINE',true,1000,'u-admin'),
         ('bv-internal','p1','INTERNAL',1,'BASELINE',true,800,'u-admin');
INSERT INTO budget_lines (id,budget_version_id,cost_category_id,description,quantity,unit_code,unit_amount,total,contingency_pct,sort_order)
  VALUES ('bl-client','bv-client','cat-civ','Pekerjaan klien',2,'Ls',500,1000,10,0),
         ('bl-internal','bv-internal','cat-civ','Pekerjaan internal',1,'Ls',800,800,0,0);
INSERT INTO purchase_records (id,project_id,supplier_name,status,summary,dpp_amount,total_amount,created_by_id)
  VALUES ('po-1','p1','PT Vendor','RECEIVED','Pengadaan material',200,200,'u-admin');
INSERT INTO contract_terms (id,project_id,type,name,amount,sort_order)
  VALUES ('term-1','p1','PROGRESS','Termin 1',100,0);
INSERT INTO customer_invoices (id,project_id,contract_term_id,number,type,total_amount,status,issue_date,due_date,dpp_amount,ppn_amount)
  VALUES ('inv-1','p1','term-1','INV-001','PROGRESS',60,'SENT','2026-01-01','2026-02-01',60,0);
`;
  await db.exec(ddl);

  const dir = path.resolve(process.cwd(), "drizzle");
  for (const file of ["0000_tenant_foundation.sql", "0001_rls_policies.sql", "0002_s2a_budgeting_ptk.sql", "0003_s2b_po_terms_co.sql", "0004_s3_field_photos.sql", "0005_hardening_invoice_notifications.sql"]) {
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

describe("migrasi S1 dari database pra-S1", () => {
  it("membuat company default dan mem-backfill data existing tanpa menghapusnya", async () => {
    const [company] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(company.id), "budget.internal.view,budget.client.view");
    const companyRows = await rows("SELECT id FROM companies WHERE slug='default'");
    expect(companyRows).toHaveLength(1);
    const client = await rows("SELECT company_id FROM clients WHERE id='c1'");
    expect(client[0].company_id).toBe(companyRows[0].id);
    const project = await rows("SELECT company_id FROM projects WHERE id='p1'");
    expect(project[0].company_id).toBe(companyRows[0].id);
  });

  it("membuat keanggotaan untuk user lama", async () => {
    const m = await rows("SELECT company_role, status FROM memberships WHERE user_id='u-admin'");
    expect(m[0]).toMatchObject({ company_role: "ADMIN", status: "ACTIVE" });
  });

  it("menyediakan view audit_logs dan trigger immutability", async () => {
    const v = await rows("SELECT count(*)::int AS n FROM pg_views WHERE viewname='audit_logs'");
    expect(v[0].n).toBe(1);
    const t = await rows("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='activity_logs_immutable'");
    expect(t[0].n).toBe(1);
  });
});

describe("migrasi S2a", () => {
  it("mengaktifkan ENABLE + FORCE RLS pada 30 tabel bisnis", async () => {
    const list = [...TABLES, "variation_orders", "variation_order_lines", "budget_phasing", "po_items", "field_photos", "document_photo_links"].map((t) => `'${t}'`).join(",");
    const r = await rows(`SELECT relname FROM pg_class WHERE relname = ANY(ARRAY[${list}]) AND relrowsecurity AND relforcerowsecurity`);
    expect(r).toHaveLength(30);
  });

  it("membuat 124 policy (120 company isolation + 4 RESTRICTIVE)", async () => {
    // 0002: 2 RESTRICTIVE RAB internal · 0005: 2 RESTRICTIVE notifikasi per user.
    const r = await rows("SELECT count(*)::int AS n FROM pg_policy");
    expect(r[0].n).toBe(124);
    const restrictive = await rows("SELECT count(*)::int AS n FROM pg_policy WHERE polpermissive = false");
    expect(restrictive[0].n).toBe(4);
  });

  it("membuat tabel PTK, baris PTK, dan phasing RAB", async () => {
    const t = await rows("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('variation_orders','variation_order_lines','budget_phasing')");
    expect(t).toHaveLength(3);
  });

  it("backfill contract_value_current dari CO approved yang SUDAH ADA", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    const r = await rows("SELECT contract_value, contract_value_current FROM projects WHERE id='p1'");
    expect(String(r[0].contract_value)).toBe("1000.00");
    expect(String(r[0].contract_value_current)).toBe("1100.00");
  });

  it("proyek baru langsung punya contract_value_current = contract_value", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    await db.exec(`INSERT INTO projects (id,code,title,client_id,stage,contract_value)
      VALUES ('p-new','PRJ-NEW','Proyek baru','c1','PLANNING',2500);`);
    const r = await rows("SELECT contract_value, contract_value_current FROM projects WHERE id='p-new'");
    expect(String(r[0].contract_value_current)).toBe(String(r[0].contract_value));
  });

  it("kolom turunan pos RAB dihitung DB (total + kontingensi)", async () => {
    const r = await rows("SELECT computed_total, contingency_amount, pagu_amount FROM budget_lines WHERE id='bl-client'");
    expect(String(r[0].computed_total)).toBe("1000.00");
    expect(String(r[0].contingency_amount)).toBe("100.00");
    expect(String(r[0].pagu_amount)).toBe("1100.00");
  });

  it("trigger SATU sumber: PTK APPROVED menaikkan nilai kontrak berjalan", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    await db.exec(`INSERT INTO variation_orders (id,project_id,code,variation_type,title,reason,scope_description,price_impact,cost_impact,time_impact_days,status,created_by_id)
      VALUES ('vo-1','p1','PTK-2026-001','ADD','Tambah panel','Permintaan klien','Satu panel',200,150,5,'APPROVED','u-admin');`);
    const r = await rows("SELECT contract_value_current FROM projects WHERE id='p1'");
    expect(String(r[0].contract_value_current)).toBe("1300.00");
  });

  it("PTK CANCELLED menurunkan kembali nilai kontrak (bisa dibatalkan)", async () => {
    await db.exec("UPDATE variation_orders SET status='CANCELLED' WHERE id='vo-1';");
    const r = await rows("SELECT contract_value_current FROM projects WHERE id='p1'");
    expect(String(r[0].contract_value_current)).toBe("1100.00");
  });

  it("guard: dampak PTK tidak boleh membuat nilai kontrak negatif", async () => {
    await db.exec(`INSERT INTO variation_orders (id,project_id,code,variation_type,title,reason,scope_description,price_impact,cost_impact,status,created_by_id)
      VALUES ('vo-neg','p1','PTK-2026-002','OMIT','Kurangi','Klien','Kurangi',-5000,0,'DRAFT','u-admin');`);
    await expect(db.exec("UPDATE variation_orders SET status='APPROVED' WHERE id='vo-neg';")).rejects.toThrow();
  });

  it("policy RESTRICTIVE: tanpa izin, RAB INTERNAL tidak terlihat (fail-closed)", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.client.view");
    const noPerm = await rows("SELECT type FROM budget_versions WHERE id IN ('bv-client','bv-internal')");
    expect(noPerm.map((r) => r.type).sort()).toEqual(["CLIENT"]);
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    const withPerm = await rows("SELECT type FROM budget_versions WHERE id IN ('bv-client','bv-internal')");
    expect(withPerm).toHaveLength(2);
  });

  it("partial unique index menolak dua baseline aktif untuk tipe sama", async () => {
    await expect(db.exec(`INSERT INTO budget_versions (id,project_id,type,version_no,status,is_active_baseline,total,created_by_id)
      VALUES ('bv-dup','p1','CLIENT',2,'APPROVED',true,2000,'u-admin');`)).rejects.toThrow();
  });

  it("trigger menolak budgetLineId lintas proyek pada expense_lines", async () => {
    await expect(db.exec(`INSERT INTO expense_lines (id,expense_id,project_id,budget_line_id,cost_category_id,description,quantity,unit_code,line_total,scope)
      VALUES ('el-1','e-x','p-lain','bl-client','cat-civ','Salah proyek',1,'Ls',10,'PROJECT');`)).rejects.toThrow();
  });

  it("isolasi company & fail-closed tetap berlaku setelah S2a", async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    await db.exec(`INSERT INTO companies (slug,name,legal_name) VALUES ('other','Other','Other');`);
    const [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    await scope(String(other.id), "budget.internal.view,budget.client.view");
    await db.exec(`INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ('c2','C2','X','X','X','${other.id}');`);
    await scope(String(a.id), "budget.internal.view,budget.client.view");
    const visible = await rows("SELECT id FROM clients");
    expect(visible.map((r) => r.id)).toEqual(["c1"]);
    await expect(db.exec(`INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ('c3','C3','X','X','X','${other.id}');`)).rejects.toThrow();
    await scope("", "");
    expect(await rows("SELECT id FROM clients")).toHaveLength(0);
  });
});


describe("migrasi S2b", () => {
  const defaultScope = async (permissions = "budget.internal.view,budget.client.view") => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), permissions);
    return String(a.id);
  };

  it("backfill PO lama menjadi satu pos dan termin dari invoice existing", async () => {
    await defaultScope();
    const po = await rows("SELECT id, dpp_amount, received_qty FROM po_items WHERE purchase_record_id='po-1'");
    expect(po).toHaveLength(1);
    expect(po[0].id).toBe("poi-po-1");
    expect(String(po[0].dpp_amount)).toBe("200.00");
    expect(String(po[0].received_qty)).toBe("1.0000");
    const term = await rows("SELECT invoiced_amount, status FROM contract_terms WHERE id='term-1'");
    expect(String(term[0].invoiced_amount)).toBe("60.00");
    expect(term[0].status).toBe("PARTIALLY_INVOICED");
  });

  it("CHECK menolak qty diterima melebihi qty pesan", async () => {
    await defaultScope();
    await expect(db.exec("UPDATE po_items SET received_qty=2 WHERE id='poi-po-1';")).rejects.toThrow();
  });

  it("pagu termin menolak invoice kedua tanpa alasan + izin approve", async () => {
    await defaultScope();
    await expect(db.exec(`INSERT INTO customer_invoices
      (id,project_id,contract_term_id,number,type,total_amount,status,issue_date,due_date,dpp_amount,ppn_amount)
      VALUES ('inv-2','p1','term-1','INV-002','PROGRESS',50,'DRAFT','2026-02-01','2026-03-01',50,0);`)).rejects.toThrow();
  });

  it("over-invoice lolos hanya dengan alasan + invoice.approve, lalu status termin jadi INVOICED", async () => {
    await defaultScope("budget.internal.view,budget.client.view,invoice.approve");
    await db.exec(`INSERT INTO customer_invoices
      (id,project_id,contract_term_id,number,type,total_amount,status,issue_date,due_date,dpp_amount,ppn_amount,over_invoice_reason)
      VALUES ('inv-2','p1','term-1','INV-002','PROGRESS',50,'DRAFT','2026-02-01','2026-03-01',50,0,'Disetujui direksi');`);
    const term = await rows("SELECT invoiced_amount, status FROM contract_terms WHERE id='term-1'");
    expect(String(term[0].invoiced_amount)).toBe("110.00");
    expect(term[0].status).toBe("INVOICED");
  });

  it("pagu nilai kontrak berlaku juga untuk invoice tanpa termin", async () => {
    await defaultScope();
    await expect(db.exec(`INSERT INTO customer_invoices
      (id,project_id,contract_term_id,number,type,total_amount,status,issue_date,due_date,dpp_amount,ppn_amount)
      VALUES ('inv-3','p1',NULL,'INV-003','OTHER',5000,'DRAFT','2026-03-01','2026-04-01',5000,0);`)).rejects.toThrow();
  });

  it("perubahan amount termin merekalkulasi status", async () => {
    await defaultScope();
    await db.exec("UPDATE contract_terms SET amount=200 WHERE id='term-1';");
    const term = await rows("SELECT status FROM contract_terms WHERE id='term-1'");
    expect(term[0].status).toBe("PARTIALLY_INVOICED");
  });

  it("trigger menolak baris tagihan PO lintas proyek", async () => {
    await defaultScope();
    await expect(db.exec(`INSERT INTO expense_lines
      (id,expense_id,project_id,po_item_id,cost_category_id,description,quantity,unit_code,line_total,scope)
      VALUES ('el-po','e-po','p-lain','poi-po-1','cat-civ','Salah proyek',1,'Ls',10,'PROJECT');`)).rejects.toThrow();
  });

  it("pos PO baru terisolasi per company", async () => {
    const [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    await scope(String(other.id), "budget.internal.view,budget.client.view");
    expect(await rows("SELECT id FROM po_items")).toHaveLength(0);
    await scope("", "");
  });
});

describe("migrasi S3 field photos", () => {
  const defaultScope = async () => {
    const [a] = await rows("SELECT id FROM companies WHERE slug='default'");
    await scope(String(a.id), "budget.internal.view,budget.client.view,document.view");
    return String(a.id);
  };

  it("file_objects.content_base64 nullable + metadata storage", async () => {
    await defaultScope();
    const columns = await rows(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name='file_objects' AND column_name IN
      ('content_base64','storage_provider','storage_bucket','width','height','original_size_bytes')`);
    expect(columns).toHaveLength(6);
    expect(columns.find((c) => c.column_name === "content_base64")?.is_nullable).toBe("YES");
    const [file] = await rows(`INSERT INTO file_objects
      (id,storage_key,file_name,mime_type,size_bytes,sha256,uploaded_by_id)
      VALUES ('f-s3-1','private/field-photos/p1/f-s3-1.jpg','foto.jpg','image/jpeg',100,'hash-1','u-admin')
      RETURNING content_base64, storage_provider`);
    expect(file.content_base64).toBeNull();
    expect(file.storage_provider).toBe("DB");
  });

  it("CHECK provider storage menolak nilai selain DB/LOCAL/S3", async () => {
    await defaultScope();
    await expect(db.exec(`INSERT INTO file_objects
      (id,storage_key,file_name,mime_type,size_bytes,sha256,uploaded_by_id,storage_provider)
      VALUES ('f-s3-bad','private/bad','bad.jpg','image/jpeg',1,'hash-bad','u-admin','FTP');`)).rejects.toThrow();
  });

  it("field_photos menyimpan metadata, kategori, tanggal, dan status pilihan laporan", async () => {
    await defaultScope();
    await db.exec(`INSERT INTO file_objects
      (id,storage_key,file_name,mime_type,size_bytes,sha256,uploaded_by_id,storage_provider,width,height,original_size_bytes)
      VALUES ('f-s3-2','private/field-photos/p1/f-s3-2.jpg','before.jpg','image/jpeg',80,'hash-2','u-admin','LOCAL',1200,900,900000),
             ('f-s3-3','private/field-photos/p1/f-s3-3.jpg','process.jpg','image/jpeg',81,'hash-3','u-admin','LOCAL',1200,900,910000),
             ('f-s3-4','private/field-photos/p1/f-s3-4.jpg','after.jpg','image/jpeg',82,'hash-4','u-admin','LOCAL',1200,900,920000),
             ('f-s3-5','private/field-photos/p-new/f-s3-5.jpg','other.jpg','image/jpeg',83,'hash-5','u-admin','LOCAL',1200,900,930000);
    INSERT INTO field_photos
      (id,project_id,file_id,category,captured_at,description,location_label,is_selected_for_report,uploaded_by_id)
      VALUES ('fp-1','p1','f-s3-2','BEFORE','2026-11-01','Kondisi awal','Grid A',true,'u-admin'),
             ('fp-2','p1','f-s3-3','PROCESS','2026-11-02','Pemasangan','Grid A',false,'u-admin'),
             ('fp-3','p1','f-s3-4','AFTER','2026-11-03','Selesai','Grid A',false,'u-admin'),
             ('fp-4','p-new','f-s3-5','PROCESS','2026-11-02','Proyek lain','Grid B',false,'u-admin');`);
    const all = await rows("SELECT category, captured_at, is_selected_for_report FROM field_photos WHERE project_id='p1' ORDER BY captured_at");
    expect(all.map((r) => r.category)).toEqual(["BEFORE", "PROCESS", "AFTER"]);
    expect(all[0].is_selected_for_report).toBe(true);
    const filtered = await rows(`SELECT category FROM field_photos
      WHERE project_id='p1' AND captured_at BETWEEN DATE '2026-11-01' AND DATE '2026-11-02'
      ORDER BY captured_at`);
    expect(filtered.map((r) => r.category)).toEqual(["BEFORE", "PROCESS"]);
    await expect(db.exec(`INSERT INTO field_photos
      (id,project_id,file_id,category,captured_at,uploaded_by_id)
      VALUES ('fp-bad','p1','f-s3-2','OTHER','2026-11-01','u-admin');`)).rejects.toThrow();
  });

  it("document_photo_links menolak foto lintas proyek dan memaksa RLS", async () => {
    const defaultCompany = await defaultScope();
    await db.exec(`INSERT INTO documents (id,project_id,template_code,status)
      VALUES ('doc-s3','p1','PROGRESS_REPORT','DRAFT');`);
    await db.exec(`INSERT INTO document_photo_links
      (id,document_id,field_photo_id,sort_order,selected_by_id)
      VALUES ('dpl-1','doc-s3','fp-1',0,'u-admin');`);
    await expect(db.exec(`INSERT INTO document_photo_links
      (id,document_id,field_photo_id,sort_order,selected_by_id)
      VALUES ('dpl-bad','doc-s3','fp-4',1,'u-admin');`)).rejects.toThrow();
    let [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    if (!other) {
      await db.exec("INSERT INTO companies (slug,name,legal_name) VALUES ('other','Other','Other');");
      [other] = await rows("SELECT id FROM companies WHERE slug='other'");
    }
    await scope(String(other.id), "document.view");
    expect(await rows("SELECT id FROM field_photos")).toHaveLength(0);
    expect(await rows("SELECT id FROM document_photo_links")).toHaveLength(0);
    await scope(defaultCompany, "budget.internal.view,budget.client.view,document.view");
  });
});

describe("migrasi 0005 hardening", () => {
  it("customer_invoices punya created_by_id dan backfill dari activity_logs", async () => {
    const defaultCompany = await defaultScope("invoice.view");
    await db.exec(`INSERT INTO activity_logs (id,object_type,object_id,action,actor_id,created_at)
      VALUES ('al-inv','INVOICE','inv-1','CREATED','u-admin', now() - interval '2 day')`);
    // Simulasi DB pra-0005: kolom sudah ada (migrasi dijalankan saat DDL), jadi
    // uji backfill dilakukan dengan mengosongkan kolom lalu menjalankan ulang UPDATE.
    await db.exec(`UPDATE customer_invoices SET created_by_id = NULL WHERE id='inv-1'`);
    await db.exec(`UPDATE customer_invoices ci
        SET created_by_id = src.actor_id
        FROM (SELECT DISTINCT ON (object_id) object_id, actor_id FROM activity_logs
               WHERE object_type='INVOICE' AND actor_id IS NOT NULL
               ORDER BY object_id, CASE action WHEN 'CREATED' THEN 0 ELSE 1 END, created_at ASC) src
       WHERE ci.id = src.object_id AND ci.created_by_id IS NULL`);
    const [inv] = await rows("SELECT created_by_id FROM customer_invoices WHERE id='inv-1'");
    expect(inv.created_by_id).toBe("u-admin");
    const columns = await rows(`SELECT column_name FROM information_schema.columns
      WHERE table_name='customer_invoices' AND column_name='created_by_id'`);
    expect(columns).toHaveLength(1);
  });

  it("notifikasi hanya terbaca oleh pemiliknya (RESTRICTIVE user scope)", async () => {
    const defaultCompany = await defaultScope("invoice.view");
    await scope(defaultCompany, "", "u-admin");
    await db.exec(`INSERT INTO users (id,role,email,name,title,password_hash)
      VALUES ('u-field','FIELD','f@x.id','Field','Site Engineer','x') ON CONFLICT (id) DO NOTHING;
      INSERT INTO notifications (id,user_id,type,title) VALUES
        ('n-admin','u-admin','APPROVAL','Untuk admin'),
        ('n-field','u-field','APPROVAL','Untuk field');`);
    await scope(defaultCompany, "", "u-admin");
    const mine = await rows("SELECT id FROM notifications ORDER BY id");
    expect(mine.map((r) => r.id)).toEqual(["n-admin"]);
    // Fail-closed: tanpa GUC user, tidak ada notifikasi yang terlihat.
    await scope(defaultCompany, "", "");
    expect(await rows("SELECT id FROM notifications")).toHaveLength(0);
    // UPDATE notifikasi milik orang lain ditolak (0 baris terpengaruh).
    await scope(defaultCompany, "", "u-admin");
    await db.exec(`UPDATE notifications SET read_at = now() WHERE id='n-field'`);
    await scope(defaultCompany, "", "u-field");
    const [field] = await rows("SELECT read_at FROM notifications WHERE id='n-field'");
    expect(field.read_at).toBeNull();
    await scope(defaultCompany, "budget.internal.view,budget.client.view,document.view", "u-admin");
  });
});
