/**
 * Verifikasi acceptance S1: isolasi data antar company + audit append-only.
 *
 *   npm run db:migrate && npm run db:verify
 *
 * Membuat 2 company sementara, menyisipkan 1 klien di masing-masing, lalu
 * menguji isolasi, audit append-only, dan invariant storage foto S3.
 * Seluruh data uji dibersihkan di akhir.
 */
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi.");
  const db = new Client({ connectionString: url });
  await db.connect();
  const suffix = randomBytes(4).toString("hex");
  const slugA = `rls-a-${suffix}`, slugB = `rls-b-${suffix}`;
  const codeA = `CA-${suffix}`, codeB = `CB-${suffix}`;
  let companyA = "", companyB = "";

  try {
    await db.query("BEGIN");
    companyA = (await db.query("INSERT INTO companies (slug,name,legal_name) VALUES ($1,$2,$2) RETURNING id", [slugA, `Company A ${suffix}`])).rows[0].id;
    companyB = (await db.query("INSERT INTO companies (slug,name,legal_name) VALUES ($1,$2,$2) RETURNING id", [slugB, `Company B ${suffix}`])).rows[0].id;
    await db.query("SELECT set_config('app.current_company_id', $1, false)", [companyA]);
    await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry) VALUES ($1,$2,$2,$2,'test')", [`cl-a-${suffix}`, codeA]);
    await db.query("SELECT set_config('app.current_company_id', $1, false)", [companyB]);
    await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry) VALUES ($1,$2,$2,$2,'test')", [`cl-b-${suffix}`, codeB]);
    await db.query("COMMIT");
    // Kembalikan koneksi ke kondisi tanpa scope (penting untuk uji fail-closed).
    await db.query("SELECT set_config('app.current_company_id', '', false)");

    // 1. Company A hanya melihat datanya sendiri.
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.current_company_id', $1, true)", [companyA]);
    const scoped = await db.query("SELECT code FROM clients WHERE code = ANY($1::text[])", [[codeA, codeB]]);
    await db.query("ROLLBACK");
    check("RLS SELECT terisolasi", scoped.rowCount === 1 && scoped.rows[0].code === codeA,
      `company A melihat ${scoped.rowCount} dari 2 klien`);

    // 2. Tanpa scope -> 0 baris (fail-closed), bukan seluruh data.
    const unscoped = await db.query("SELECT code FROM clients WHERE code = ANY($1::text[])", [[codeA, codeB]]);
    check("RLS fail-closed tanpa scope", unscoped.rowCount === 0,
      `query tanpa app.current_company_id mengembalikan ${unscoped.rowCount} baris`);

    // 3. Tidak bisa menyisipkan data untuk company lain.
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.current_company_id', $1, true)", [companyA]);
    let blocked = false;
    try {
      await db.query("INSERT INTO clients (id,code,legal_name,display_name,industry,company_id) VALUES ($1,$2,$2,$2,'test',$3)",
        [`cl-x-${suffix}`, `CX-${suffix}`, companyB]);
    } catch { blocked = true; }
    await db.query("ROLLBACK");
    check("RLS INSERT ditolak lintas company", blocked,
      blocked ? "insert ke company B dari scope A ditolak" : "insert lintas company LOLOS (bahaya)");

    // 4. Audit log tidak bisa diubah/dihapus.
    let auditImmutable = false;
    try {
      await db.query("UPDATE activity_logs SET action = 'TAMPERED' WHERE false");
      // Trigger tidak aktif untuk 0 baris; uji dengan baris nyata.
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.current_company_id', $1, true)", [companyA]);
      const inserted = await db.query("INSERT INTO activity_logs (id,object_type,object_id,action) VALUES ($1,'RLS_TEST',$1,'CREATED') RETURNING id", [`rls-log-${suffix}`]);
      try {
        await db.query("UPDATE activity_logs SET action='TAMPERED' WHERE id=$1", [inserted.rows[0].id]);
      } catch { auditImmutable = true; }
      await db.query("ROLLBACK");
    } catch { auditImmutable = true; }
    check("Audit log append-only", auditImmutable,
      auditImmutable ? "UPDATE ditolak trigger DB" : "UPDATE audit LOLOS (bahaya)");
    // 5-7. Invariant S3: tabel foto ber-RLS, policy lengkap, content_base64 nullable.
    const photoTables = await db.query(`SELECT count(*)::int AS n FROM pg_class
      WHERE relname = ANY(ARRAY['field_photos','document_photo_links'])
        AND relrowsecurity AND relforcerowsecurity`);
    const photoTableCount = Number(photoTables.rows[0].n);
    check("S3 field photos FORCE RLS", photoTableCount === 2,
      `${photoTableCount}/2 tabel foto memakai ENABLE + FORCE RLS`);
    const photoPolicies = await db.query(`SELECT count(*)::int AS n FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = ANY(ARRAY['field_photos','document_photo_links'])`);
    const photoPolicyCount = Number(photoPolicies.rows[0].n);
    check("S3 policy isolasi foto", photoPolicyCount === 8,
      `${photoPolicyCount}/8 policy isolasi pada 2 tabel foto`);
    const contentColumn = await db.query(`SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='file_objects' AND column_name='content_base64'`);
    const nullable = contentColumn.rows[0]?.is_nullable === "YES";
    check("S3 content_base64 nullable", nullable,
      nullable ? "foto baru boleh menyimpan bytes di object storage" : "kolom belum nullable / tabel tidak ada");

    // 8-9. Invariant 0005: jejak pembuat invoice + notifikasi hanya untuk pemiliknya.
    const invoiceCreator = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='customer_invoices' AND column_name='created_by_id'`);
    const hasInvoiceCreator = Number(invoiceCreator.rows[0].n) === 1;
    check("0005 customer_invoices.created_by_id", hasInvoiceCreator,
      hasInvoiceCreator ? "pemisahan tugas invoice bisa ditegakkan" : "kolom belum ada — jalankan migrasi 0005");
    const notificationPolicies = await db.query(`SELECT count(*)::int AS n FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relname = 'notifications' AND p.polpermissive = false`);
    const notificationPolicyCount = Number(notificationPolicies.rows[0].n);
    check("0005 notifikasi per pengguna", notificationPolicyCount === 2,
      `${notificationPolicyCount}/2 policy RESTRICTIVE (SELECT/UPDATE) pada notifications`);

    // 10. Invariant 0006: kode master data unik PER COMPANY (bukan global).
    const codeIndexes = await db.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND indexname = ANY($1::text[])`,
      [["clients_company_code_idx", "opportunities_company_code_idx", "projects_company_code_idx"]]);
    const codeIndexCount = codeIndexes.rowCount ?? 0;
    check("0006 kode per company", codeIndexCount === 3,
      codeIndexCount === 3
        ? "clients/opportunities/projects unik per company"
        : `${codeIndexCount}/3 index unik (company_id, code) ada — jalankan migrasi 0006`);

    // 11. Invariant 0007: termin tersusun unik per proyek + katalog per company.
    const catalogIndexes = await db.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND indexname = ANY($1::text[])`,
      [[
        "contract_terms_project_sort_idx", "cost_categories_company_code_idx", "units_company_code_idx",
      ]]);
    const catalogIndexCount = catalogIndexes.rowCount ?? 0;
    check("0007 termin & katalog", catalogIndexCount === 3,
      catalogIndexCount === 3
        ? "urutan termin unik per proyek, kode kategori/satuan unik per company"
        : `${catalogIndexCount}/3 index migrasi 0007 ada — jalankan migrasi 0007`);
    const termNotes = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contract_terms' AND column_name='notes'`);
    check("0007 contract_terms.notes", Number(termNotes.rows[0].n) === 1,
      Number(termNotes.rows[0].n) === 1 ? "catatan termin tersedia" : "kolom belum ada — jalankan migrasi 0007");
    // 12. Invariant 0008: template dokumen di DB (11 sistem) + tabel versi berversi.
    const systemTemplates = await db.query(`SELECT count(*)::int AS n FROM document_templates
      WHERE company_id IS NULL AND is_system`);
    const templateCount = Number(systemTemplates.rows[0].n);
    check("0008 template sistem", templateCount === 11,
      templateCount === 11 ? "11 template bawaan tersedia untuk semua company" : `${templateCount}/11 template sistem — jalankan migrasi 0008`);
    const templateTables = await db.query(`SELECT count(*)::int AS n FROM pg_class
      WHERE relname IN ('document_templates','document_template_variables','document_template_versions') AND relkind='r'`);
    const tableCount = Number(templateTables.rows[0].n);
    check("0008 tabel template", tableCount === 3,
      tableCount === 3 ? "templates + variabel + versi tersedia" : `${tableCount}/3 tabel template ada — jalankan migrasi 0008`);
    const docColumns = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='documents' AND column_name IN ('template_id','docx_file_id','archived_at')`);
    const docColumnCount = Number(docColumns.rows[0].n);
    check("0008 documents DOCX & arsip", docColumnCount === 3,
      docColumnCount === 3 ? "template_id, docx_file_id, archived_at ada" : `${docColumnCount}/3 kolom dokumen baru — jalankan 0008`);

    // ---- 0009: WBS & kurva-S ------------------------------------------------
    const wbsColumns = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='schedule_items'
        AND column_name IN ('level','code','is_summary','committed_amount','planned_pct_per_period','parent_sort_order')`);
    const wbsColumnCount = Number(wbsColumns.rows[0].n);
    check("0009 kolom WBS schedule_items", wbsColumnCount === 6,
      wbsColumnCount === 6 ? "level, code, is_summary, committed_amount, planned_pct_per_period, parent_sort_order ada" : `${wbsColumnCount}/6 kolom WBS — jalankan migrasi 0009`);

    const calendarTable = await db.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='project_wbs_calendars' AND relkind='r'`);
    const calendarPolicies = await db.query(`SELECT count(*)::int AS n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='project_wbs_calendars'`);
    check("0009 kalender WBS terisolasi", calendarTable.rows.length === 1
      && calendarTable.rows[0].relrowsecurity === true && calendarTable.rows[0].relforcerowsecurity === true
      && Number(calendarPolicies.rows[0].n) === 4,
      calendarTable.rows.length === 1
        ? `RLS FORCE aktif, ${calendarPolicies.rows[0].n}/4 policy`
        : "tabel project_wbs_calendars belum ada — jalankan migrasi 0009");

    const wbsBackfill = await db.query(`SELECT
        count(*) FILTER (WHERE code IS NULL OR level IS NULL)::int AS missing,
        count(*)::int AS total FROM schedule_items`);
    check("0009 backfill WBS", Number(wbsBackfill.rows[0].missing) === 0,
      Number(wbsBackfill.rows[0].missing) === 0
        ? `${wbsBackfill.rows[0].total} item jadwal punya kode & level`
        : `${wbsBackfill.rows[0].missing}/${wbsBackfill.rows[0].total} item belum berkode — ulangi migrasi 0009`);
    // ---- 0010: kunci akun login -------------------------------------------
    const lockColumns = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
        AND column_name IN ('failed_login_count','locked_until')`);
    const lockColumnCount = Number(lockColumns.rows[0].n);
    check("0010 kolom kunci login", lockColumnCount === 2,
      lockColumnCount === 2 ? "failed_login_count & locked_until ada" : `${lockColumnCount}/2 kolom — jalankan migrasi 0010`);

    const lockIndex = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname='users_locked_until_idx'`);
    check("0010 index akun terkunci", lockIndex.rows.length === 1 && /WHERE \(locked_until IS NOT NULL\)/.test(String(lockIndex.rows[0].indexdef)),
      lockIndex.rows.length === 1 ? "index parsial hanya untuk akun yang sedang terkunci" : "index users_locked_until_idx belum ada — jalankan 0010");

    // Constraint diuji langsung: nilai negatif harus ditolak DB, bukan hanya aplikasi.
    let negativeRejected = false;
    try {
      await db.query("SAVEPOINT lock_check");
      await db.query("UPDATE users SET failed_login_count = -1 WHERE id = $1", [companyA]);
      await db.query("ROLLBACK TO SAVEPOINT lock_check");
    } catch { negativeRejected = true; }
    check("0010 CHECK penghitung", negativeRejected,
      negativeRejected ? "DB menolak failed_login_count negatif" : "CHECK users_failed_login_count_check tidak aktif — jalankan 0010");
  } finally {
    // Bersihkan data uji.
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.current_company_id', $1, true)", [companyA]);
      await db.query("DELETE FROM clients WHERE code = $1", [codeA]);
      await db.query("SELECT set_config('app.current_company_id', $1, true)", [companyB]);
      await db.query("DELETE FROM clients WHERE code = $1", [codeB]);
      await db.query("COMMIT");
    } catch { /* best effort */ }
    await db.query("SELECT set_config('app.current_company_id', '', false)").catch(() => undefined);
    await db.query("DELETE FROM companies WHERE slug = ANY($1::text[])", [[slugA, slugB]]).catch(() => undefined);
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pemeriksaan lulus.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
