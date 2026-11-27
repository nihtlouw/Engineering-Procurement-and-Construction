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
