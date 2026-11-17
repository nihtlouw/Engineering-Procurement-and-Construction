/**
 * Seed data demo — HANYA lewat CLI, TIDAK pernah dipanggil dari request.
 *
 *   SEED_DEMO_PASSWORD='...' npm run db:seed:demo
 *
 * Ditolak di production kecuali ALLOW_DEMO_SEED=yes (untuk environment uji
 * yang sengaja memakai data palsu). Tidak ada fallback password di kode.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";

config({ path: ".env.local", quiet: true });

const { clients, companies, costCategories, memberships, projects, sites, users } = schema;

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "yes") {
    throw new Error("Seed demo diblokir di production. Set ALLOW_DEMO_SEED=yes hanya untuk environment uji.");
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("SEED_DEMO_PASSWORD wajib diisi (minimal 8 karakter). Tidak ada password bawaan.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi.");

  // max: 1 agar set_config(..., false) berlaku untuk SELURUH insert berikutnya.
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    // scrypt identik dengan src/lib/auth.ts (tidak meng-import next/headers).
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

    await db.insert(companies).values({
      slug: "demo", name: "Ardaya EPC (Demo)", legalName: "PT Ardaya Energi Sistem",
      email: "kontak@ardaya-epc.co.id",
    }).onConflictDoNothing();
    const [existingCompany] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, "demo")).limit(1);
    if (!existingCompany) throw new Error("Company demo gagal dibuat.");
    const companyId = existingCompany.id;

    await pool.query("SELECT set_config('app.current_company_id', $1, false)", [companyId]);

    const roles = [
      ["u-admin", "Aditya Nugraha", "admin@ardaya.id", "ADMIN", "Direktur Operasional"],
      ["u-estimator", "Nadia Kusuma", "estimator@ardaya.id", "ESTIMATOR", "Senior Estimator"],
      ["u-pm", "Bagas Prasetyo", "pm@ardaya.id", "PM", "Project Manager"],
      ["u-field", "Rizky Ramadhan", "field@ardaya.id", "FIELD", "Site Engineer"],
      ["u-procurement", "Sinta Maharani", "procurement@ardaya.id", "PROCUREMENT", "Procurement Lead"],
      ["u-finance", "Maya Puspita", "finance@ardaya.id", "FINANCE", "Finance Controller"],
    ] as const;
    await db.insert(users).values(roles.map(([id, name, email, role, title]) => ({
      id, name, email, role, title, passwordHash,
    }))).onConflictDoNothing();
    await db.insert(memberships).values(roles.map(([id, , , role]) => ({
      companyId, userId: id, companyRole: role, status: "ACTIVE",
    }))).onConflictDoNothing();

    await db.insert(costCategories).values([
      { id: "cat-civ", code: "CIV", name: "Sipil & Mekanikal Pendukung" },
      { id: "cat-lab", code: "LAB", name: "Tenaga Kerja & Subkon" },
      { id: "cat-mat", code: "MAT", name: "Material & Peralatan" },
    ]).onConflictDoNothing();

    await db.insert(clients).values([
      { id: "c-arunika", code: "CL-001", legalName: "PT Arunika Retail Indonesia", displayName: "Arunika Retail", industry: "Retail" },
      { id: "c-ndc", code: "CL-002", legalName: "PT Nusantara Data Center", displayName: "NDC", industry: "Data Center" },
    ]).onConflictDoNothing();
    await db.insert(sites).values([
      { id: "s-cikarang", clientId: "c-arunika", name: "DC Cikarang", address: "Jl. Raya Cikarang, Bekasi" },
      { id: "s-genset", clientId: "c-ndc", name: "Site Genset NDC", address: "Kawasan Industri, Bekasi" },
    ]).onConflictDoNothing();
    await db.insert(projects).values([
      { id: "p-lvmdp", code: "PRJ-2025-009", title: "Modernisasi LVMDP & ATS", clientId: "c-arunika", siteId: "s-cikarang", pmId: "u-pm", stage: "COMPLETED", contractValue: "4850000000", startDate: "2025-10-01", targetEndDate: "2026-03-06", isLocked: true },
      { id: "p-genset", code: "PRJ-2026-014", title: "Instalasi Genset & Sinkronisasi", clientId: "c-ndc", siteId: "s-genset", pmId: "u-pm", stage: "IN_PROGRESS", contractValue: "4200000000", startDate: "2026-05-20", targetEndDate: "2026-12-18" },
    ]).onConflictDoNothing();

    console.log(`Seed demo selesai. companyId=${companyId}`);
    console.log("Login: pm@ardaya.id / <SEED_DEMO_PASSWORD yang Anda set>");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
