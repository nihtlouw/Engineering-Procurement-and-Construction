import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { count } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, budgetLines, budgetVersions, changeOrders, clients, companySettings, contractTerms,
  costCategories, customerInvoices, customerPayments, documents, expenseLines, expenses, fileObjects,
  handoverItems, notifications, opportunities, progressUpdates, projectMembers, projects, punchItems,
  purchaseRecords, scheduleItems, sites, units, users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { D, money } from "@/lib/format";

let seedPromise: Promise<void> | null = null;

async function makePdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("PT ARDAYA ENERGI SISTEM", { x: 48, y: 790, size: 10, font: bold, color: rgb(0.12, 0.16, 0.14) });
  page.drawText(title, { x: 48, y: 748, size: 18, font: bold, color: rgb(0.08, 0.1, 0.09) });
  page.drawLine({ start: { x: 48, y: 730 }, end: { x: 547, y: 730 }, thickness: 1, color: rgb(0.65, 0.7, 0.66) });
  lines.forEach((line, index) => page.drawText(line.replace(/[^\x20-\x7E]/g, "-"), { x: 48, y: 700 - index * 22, size: 10, font, color: rgb(0.18, 0.2, 0.19) }));
  page.drawText("Dokumen final - snapshot data tersimpan dan terkunci.", { x: 48, y: 52, size: 8, font, color: rgb(0.4, 0.43, 0.41) });
  return Buffer.from(await pdf.save()).toString("base64");
}

async function seed() {
  const existing = await db.select({ value: count() }).from(users);
  if (Number(existing[0]?.value ?? 0) > 0) return;
  const password = process.env.SEED_DEMO_PASSWORD || "DemoEPC2026!";
  const passwordHash = hashPassword(password);
  await db.insert(companySettings).values({
    id: "company", legalName: "PT Ardaya Energi Sistem", displayName: "Ardaya EPC", npwp: "01.234.567.8-091.000",
    address: "Jl. Raya Bekasi KM 22, Cakung, Jakarta Timur 13910", phone: "+62 21 4682 7700", email: "kontak@ardaya-epc.co.id",
    defaultPpnRate: "11", allowSplitExpense: false,
  });
  await db.insert(users).values([
    { id: "u-admin", name: "Aditya Nugraha", email: "admin@ardaya.id", role: "ADMIN", title: "Direktur Operasional", passwordHash },
    { id: "u-estimator", name: "Nadia Kusuma", email: "estimator@ardaya.id", role: "ESTIMATOR", title: "Senior Estimator", passwordHash },
    { id: "u-pm", name: "Bagas Prasetyo", email: "pm@ardaya.id", role: "PM", title: "Project Manager", passwordHash },
    { id: "u-field", name: "Rizky Ramadhan", email: "field@ardaya.id", role: "FIELD", title: "Site Engineer", passwordHash },
    { id: "u-procurement", name: "Sinta Maharani", email: "procurement@ardaya.id", role: "PROCUREMENT", title: "Procurement Lead", passwordHash },
    { id: "u-finance", name: "Maya Puspita", email: "finance@ardaya.id", role: "FINANCE", title: "Finance Controller", passwordHash },
  ]);
  await db.insert(clients).values([
    { id: "c-ndc", code: "CL-001", legalName: "PT Nusantara Data Infrastructure", displayName: "Nusantara Data Center", industry: "Data center & telekomunikasi", npwp: "02.811.445.1-015.000", address: "Equity Tower Lt. 32, SCBD, Jakarta Selatan", contactName: "Fajar Wibowo", contactPhone: "+62 811 9002 118" },
    { id: "c-arunika", code: "CL-002", legalName: "PT Arunika Retail Indonesia", displayName: "Arunika Retail Group", industry: "Ritel & logistik", npwp: "03.117.902.4-423.000", address: "Kawasan Industri MM2100, Cikarang Barat, Bekasi", contactName: "Dewi Anggraini", contactPhone: "+62 812 8871 4430" },
  ]);
  await db.insert(sites).values([
    { id: "s-jkt2", clientId: "c-ndc", name: "NDC Jakarta 2 — Cakung", address: "Jl. Raya Cakung Cilincing KM 3, Jakarta Timur", contact: "Yoga / Facility Lead", latitude: "-6.1742000", longitude: "106.9431000" },
    { id: "s-bgr1", clientId: "c-ndc", name: "NDC Bogor 1 — Sentul", address: "Sentul Industrial Estate, Bogor", contact: "Andri / Facility Manager", latitude: "-6.5689000", longitude: "106.8650000" },
    { id: "s-ckr", clientId: "c-arunika", name: "Distribution Center Cikarang", address: "Blok F-12, MM2100, Cikarang Barat", contact: "Hendra / Engineering", latitude: "-6.3137000", longitude: "107.0889000" },
  ]);
  await db.insert(opportunities).values([
    { id: "opp-1", code: "OPP-2026-021", title: "Backup Power 2 × 500 kVA NDC Jakarta 2", clientId: "c-ndc", siteId: "s-jkt2", ownerId: "u-estimator", requirement: "Sistem genset redundan N+1, sinkronisasi, fuel system 24 jam, loadbank test dan SLO.", dueDate: "2026-05-12", estimatedValue: "4850000000", status: "AWARDED" },
    { id: "opp-2", code: "OPP-2026-034", title: "Peningkatan Kapasitas LVMDP NDC Bogor 1", clientId: "c-ndc", siteId: "s-bgr1", ownerId: "u-estimator", requirement: "Penggantian ACB 4000 A, busbar, TVSS dan integrasi monitoring tanpa downtime operasional.", dueDate: "2026-11-08", estimatedValue: "2150000000", status: "CLARIFICATION" },
    { id: "opp-3", code: "OPP-2026-039", title: "Rooftop PV & Panel Interkoneksi DC Cikarang", clientId: "c-arunika", siteId: "s-ckr", ownerId: "u-estimator", requirement: "PV atap 450 kWp, inverter terdistribusi, panel interkoneksi dan studi proteksi.", dueDate: "2026-12-02", estimatedValue: "5750000000", status: "ESTIMATING" },
  ]);
  await db.insert(projects).values([
    { id: "p-genset", code: "PRJ-2026-014", title: "Sistem Genset 2 × 500 kVA — NDC Jakarta 2", clientId: "c-ndc", siteId: "s-jkt2", opportunityId: "opp-1", pmId: "u-pm", stage: "IN_PROGRESS", contractNumber: "024/NDC/EPC/V/2026", contractDate: "2026-05-20", contractValue: "4850000000", contractPpn: "533500000", retentionPct: "5", warrantyMonths: 12, startDate: "2026-06-01", targetEndDate: "2026-12-18" },
    { id: "p-lvmdp", code: "PRJ-2025-009", title: "Modernisasi LVMDP & ATS — DC Cikarang", clientId: "c-arunika", siteId: "s-ckr", pmId: "u-pm", stage: "WARRANTY_PERIOD", contractNumber: "118/ARU/ENG/IX/2025", contractDate: "2025-09-12", contractValue: "1680000000", contractPpn: "184800000", retentionPct: "5", warrantyMonths: 12, startDate: "2025-10-01", targetEndDate: "2026-02-27", bast1Date: "2026-03-06" },
  ]);
  const memberships = [
    ...["p-genset", "p-lvmdp"].flatMap((projectId) => [
      { projectId, userId: "u-pm", projectRole: "PM" }, { projectId, userId: "u-finance", projectRole: "FINANCE" },
      { projectId, userId: "u-procurement", projectRole: "PROCUREMENT" }, { projectId, userId: "u-estimator", projectRole: "ESTIMATOR" },
    ]),
    { projectId: "p-genset", userId: "u-field", projectRole: "FIELD" }, { projectId: "p-lvmdp", userId: "u-field", projectRole: "FIELD" },
  ].map((m, i) => ({ id: `mem-${i + 1}`, ...m }));
  await db.insert(projectMembers).values(memberships);
  await db.insert(costCategories).values([
    { id: "cat-eqp", code: "EQP", name: "Main Equipment" }, { id: "cat-mat", code: "MAT", name: "Material Elektrikal & Bantu" },
    { id: "cat-civ", code: "CIV", name: "Sipil & Mekanikal Pendukung" }, { id: "cat-lab", code: "LAB", name: "Tenaga Kerja & Subkon" },
    { id: "cat-log", code: "LOG", name: "Mobilisasi, Alat Berat & Operasional" }, { id: "cat-com", code: "COM", name: "Testing, Commissioning & Perizinan" },
    { id: "cat-ovh-adm", code: "OVH-ADM", name: "Overhead Administrasi", isOverhead: true }, { id: "cat-ovh-ops", code: "OVH-OPS", name: "Overhead Operasional Kantor", isOverhead: true },
    { id: "cat-ovh-mkt", code: "OVH-MKT", name: "Overhead Pemasaran/Tender", isOverhead: true },
  ]);
  await db.insert(units).values(["Unit|Unit", "Set|Set", "Panel|Panel", "Lot|Lot", "Ls|Lump Sum", "m'|Meter", "m2|Meter Persegi", "m3|Meter Kubik", "Btg|Batang", "Roll|Roll", "Hasbel|Hasbel", "Titik|Titik", "Liter|Liter", "Kg|Kilogram", "OH|Orang Hari", "Bln|Bulan", "Pcs|Pieces", "Box|Box", "Jam|Jam"].map((item, i) => { const [code, name] = item.split("|"); return { id: `unit-${i + 1}`, code, name }; }));

  const clientLines1 = [
    ["EQP-01", "cat-eqp", "Genset 500 kVA, silent canopy, radiator 50°C", "2", "Unit", "1375000000"],
    ["EQP-02", "cat-eqp", "Panel ATS/AMF sinkronisasi 2 genset + PLN", "1", "Panel", "640000000"],
    ["MAT-01", "cat-mat", "Kabel power, tray, termination dan aksesori", "1", "Lot", "385000000"],
    ["LAB-01", "cat-lab", "Instalasi mekanikal-elektrikal dan fuel system", "1", "Ls", "520000000"],
    ["COM-01", "cat-com", "FAT, loadbank test, commissioning dan SLO", "1", "Ls", "250000000"],
    ["CIV-01", "cat-civ", "Pondasi, exhaust, ventilasi dan sipil pendukung", "1", "Ls", "305000000"],
  ] as const;
  const internalAmounts1 = ["2250000000", "480000000", "325000000", "390000000", "180000000", "245000000"];
  const clientLines2 = [
    ["EQP-01", "cat-eqp", "LVMDP 4000 A lengkap ACB, MCCB dan metering", "1", "Panel", "925000000"],
    ["EQP-02", "cat-eqp", "Panel ATS 2500 A dan kontrol otomatis", "1", "Panel", "315000000"],
    ["MAT-01", "cat-mat", "Busbar, kabel, termination dan aksesori", "1", "Lot", "170000000"],
    ["LAB-01", "cat-lab", "Bongkar-pasang, shutdown management dan instalasi", "1", "Ls", "190000000"],
    ["COM-01", "cat-com", "Uji relay, megger, grounding dan commissioning", "1", "Ls", "80000000"],
  ] as const;
  const internalAmounts2 = ["710000000", "230000000", "142000000", "158000000", "70000000"];
  const budgetRows: (typeof budgetVersions.$inferInsert)[] = [];
  const lineRows: (typeof budgetLines.$inferInsert)[] = [];
  const buildBudget = (projectId: string, type: "CLIENT" | "INTERNAL", definitions: readonly (readonly [string, string, string, string, string, string])[], internalAmounts?: string[]) => {
    const id = `bud-${projectId}-${type.toLowerCase()}-1`;
    const amounts = definitions.map((line, index) => type === "INTERNAL" ? internalAmounts?.[index] ?? "0" : D(line[3]).times(line[5]).toFixed(0));
    budgetRows.push({ id, projectId, type, versionNo: 1, status: "BASELINE", isActiveBaseline: true, total: amounts.reduce((s, a) => s.plus(a), D(0)).toFixed(2), approvedById: "u-admin", approvedAt: new Date("2026-05-25T02:00:00Z"), createdById: type === "CLIENT" ? "u-estimator" : "u-pm" });
    definitions.forEach((line, index) => lineRows.push({ id: `bl-${projectId}-${type.toLowerCase()}-${index + 1}`, budgetVersionId: id, costCategoryId: line[1], code: line[0], description: line[2], quantity: line[3], unitCode: line[4], unitAmount: type === "INTERNAL" ? D(amounts[index]).div(line[3]).toFixed(2) : line[5], total: money(amounts[index]), sortOrder: index }));
  };
  buildBudget("p-genset", "CLIENT", clientLines1);
  buildBudget("p-genset", "INTERNAL", clientLines1, internalAmounts1);
  buildBudget("p-lvmdp", "CLIENT", clientLines2);
  buildBudget("p-lvmdp", "INTERNAL", clientLines2, internalAmounts2);
  await db.insert(budgetVersions).values(budgetRows);
  await db.insert(budgetLines).values(lineRows);

  const termDefinitions = [["DP", "Uang muka setelah kontrak", "30"], ["MOS", "Material utama tiba di site", "40"], ["PROGRESS", "Progres instalasi & commissioning", "20"], ["HANDOVER_BAST1", "Serah terima BAST 1", "5"], ["RETENTION_BAST2", "Retensi setelah BAST 2", "5"]] as const;
  const terms: (typeof contractTerms.$inferInsert)[] = [];
  for (const [projectId, value, prefix] of [["p-genset", "4850000000", "g"], ["p-lvmdp", "1680000000", "l"]] as const) {
    termDefinitions.forEach(([type, name, percent], index) => terms.push({ id: `term-${prefix}-${index + 1}`, projectId, type, name, percent, amount: D(value).times(percent).div(100).toFixed(2), trigger: name, targetDate: projectId === "p-genset" ? ["2026-05-27", "2026-09-30", "2026-11-20", "2026-12-18", "2027-12-18"][index] : ["2025-09-20", "2025-12-15", "2026-02-10", "2026-03-06", "2027-03-06"][index], sortOrder: index }));
  }
  await db.insert(contractTerms).values(terms);

  await db.insert(purchaseRecords).values([
    { id: "po-1", projectId: "p-genset", supplierName: "PT Daya Generator Nusantara", poNumber: "PO/EPC/2026/061", status: "PARTIALLY_RECEIVED", summary: "2 unit genset 500 kVA termasuk canopy dan tangki harian", dppAmount: "2200000000", ppnAmount: "242000000", totalAmount: "2442000000", orderDate: "2026-06-05", expectedDate: "2026-09-15", budgetLineId: "bl-p-genset-internal-1", createdById: "u-procurement" },
    { id: "po-2", projectId: "p-genset", supplierName: "PT Panelindo Sistem Kontrol", poNumber: "PO/EPC/2026/074", status: "RECEIVED", summary: "Panel ATS/AMF sinkronisasi lengkap dengan PLC", dppAmount: "480000000", ppnAmount: "52800000", totalAmount: "532800000", orderDate: "2026-06-18", expectedDate: "2026-08-28", budgetLineId: "bl-p-genset-internal-2", createdById: "u-procurement" },
    { id: "po-3", projectId: "p-genset", supplierName: "PT Kabel Prima Elektrik", poNumber: "PO/EPC/2026/088", status: "ORDERED", summary: "Kabel NYY 4x240, tray dan termination kit", dppAmount: "278500000", ppnAmount: "30635000", totalAmount: "309135000", orderDate: "2026-08-03", expectedDate: "2026-10-26", budgetLineId: "bl-p-genset-internal-3", createdById: "u-procurement" },
    { id: "po-4", projectId: "p-lvmdp", supplierName: "PT Panelindo Sistem Kontrol", poNumber: "PO/EPC/2025/141", status: "CLOSED", summary: "LVMDP 4000 A dan ATS 2500 A", dppAmount: "900000000", ppnAmount: "99000000", totalAmount: "999000000", orderDate: "2025-10-08", expectedDate: "2025-12-20", budgetLineId: "bl-p-lvmdp-internal-1", createdById: "u-procurement" },
  ]);

  type SeedExpense = { id: string; projectId: string | null; po?: string; merchant: string; receipt: string; date: string; dpp: string; ppn?: string; status: string; paidBy?: "COMPANY" | "EMPLOYEE"; settlement?: string; category: string; budgetLine?: string; description: string; creator?: string; approver?: string; note?: string; submitted?: boolean; scope?: string };
  const expenseSeed: SeedExpense[] = [
    { id: "exp-1", projectId: "p-genset", po: "po-1", merchant: "PT Daya Generator Nusantara", receipt: "INV/DGN/0881", date: "2026-07-02", dpp: "660000000", ppn: "72600000", status: "APPROVED", category: "cat-eqp", budgetLine: "bl-p-genset-internal-1", description: "Termin DP 30% pengadaan genset 2 × 500 kVA", creator: "u-procurement", approver: "u-finance" },
    { id: "exp-2", projectId: "p-genset", po: "po-2", merchant: "PT Panelindo Sistem Kontrol", receipt: "PSC-INV-2026-319", date: "2026-09-02", dpp: "480000000", ppn: "52800000", status: "APPROVED", category: "cat-eqp", budgetLine: "bl-p-genset-internal-2", description: "Pelunasan panel ATS/AMF setelah FAT dan penerimaan", creator: "u-procurement", approver: "u-finance" },
    { id: "exp-3", projectId: "p-genset", merchant: "Toko Listrik Sumber Jaya", receipt: "SJ-1026-00981", date: "2026-10-08", dpp: "86450000", ppn: "0", status: "APPROVED", category: "cat-mat", budgetLine: "bl-p-genset-internal-3", description: "Kabel kontrol, cable gland, lug dan material terminasi", creator: "u-field", approver: "u-pm" },
    { id: "exp-4", projectId: "p-genset", merchant: "CV Karya Instalasi Mandiri", receipt: "KIM/INV/X/044", date: "2026-10-12", dpp: "42750000", ppn: "0", status: "APPROVED", category: "cat-lab", budgetLine: "bl-p-genset-internal-4", description: "Upah instalasi tray dan penarikan kabel periode minggu 2", creator: "u-pm", approver: "u-finance" },
    { id: "exp-5", projectId: "p-genset", merchant: "PT Logistik Berat Andalan", receipt: "LBA-260918-117", date: "2026-09-18", dpp: "18250000", ppn: "2007500", status: "APPROVED", category: "cat-log", budgetLine: "bl-p-genset-internal-4", description: "Sewa crane 25 ton dan mobilisasi genset ke ruang genset", creator: "u-field", approver: "u-pm" },
    { id: "exp-6", projectId: "p-genset", merchant: "PT Uji Beban Presisi", receipt: "UBP/QUO/1026", date: "2026-10-21", dpp: "37500000", ppn: "4125000", status: "SUBMITTED", category: "cat-com", budgetLine: "bl-p-genset-internal-5", description: "Sewa loadbank 800 kW untuk uji beban bertahap 2 hari", creator: "u-field", approver: "u-pm", paidBy: "EMPLOYEE", settlement: "PENDING", note: "Jadwal uji 27–28 Oktober, mohon persetujuan sebelum mobilisasi." },
    { id: "exp-7", projectId: "p-genset", merchant: "Bengkel Las Baja Ringan", receipt: "BLBR-0092", date: "2026-10-19", dpp: "6840000", ppn: "0", status: "NEEDS_CORRECTION", category: "cat-civ", budgetLine: "bl-p-genset-internal-6", description: "Pembuatan bracket exhaust dan kanopi ventilasi", creator: "u-field", approver: "u-pm", note: "Dikembalikan: foto nota belum memperlihatkan nomor dan rincian item." },
    { id: "exp-8", projectId: null, merchant: "PT Solusi Cetak Dokumen", receipt: "SCD-88712", date: "2026-10-20", dpp: "4200000", ppn: "462000", status: "SUBMITTED", scope: "OVERHEAD", category: "cat-ovh-adm", description: "Cetak dan jilid dokumen tender serta company profile", creator: "u-estimator", approver: "u-finance" },
    { id: "exp-9", projectId: "p-genset", merchant: "SPBU Shell Cakung", receipt: "DRAFT-LOCAL", date: "2026-10-22", dpp: "3750000", ppn: "0", status: "DRAFT", category: "cat-log", budgetLine: "bl-p-genset-internal-4", description: "Solar untuk uji mesin dan operasional pompa transfer", creator: "u-field", paidBy: "EMPLOYEE", settlement: "PENDING" },
    { id: "exp-10", projectId: "p-lvmdp", po: "po-4", merchant: "PT Panelindo Sistem Kontrol", receipt: "PSC-INV-2025-811", date: "2025-12-22", dpp: "620000000", ppn: "68200000", status: "APPROVED", category: "cat-eqp", budgetLine: "bl-p-lvmdp-internal-1", description: "Tagihan termin penerimaan LVMDP dan panel ATS", creator: "u-procurement", approver: "u-finance" },
    { id: "exp-11", projectId: "p-lvmdp", merchant: "CV Karya Instalasi Mandiri", receipt: "KIM/INV/I/112", date: "2026-01-30", dpp: "128000000", ppn: "0", status: "APPROVED", category: "cat-lab", budgetLine: "bl-p-lvmdp-internal-4", description: "Upah bongkar pasang LVMDP dan pekerjaan shutdown", creator: "u-pm", approver: "u-finance" },
    { id: "exp-12", projectId: "p-lvmdp", merchant: "PT Sertifikasi Instalasi Nasional", receipt: "SIN/2026/0228", date: "2026-02-20", dpp: "45000000", ppn: "4950000", status: "APPROVED", category: "cat-com", budgetLine: "bl-p-lvmdp-internal-5", description: "Pengujian proteksi, megger dan penerbitan laporan commissioning", creator: "u-pm", approver: "u-finance" },
  ];
  await db.insert(expenses).values(expenseSeed.map((e, index) => ({ id: e.id, code: `EXP-2026-${String(index + 41).padStart(6, "0")}`, type: e.po ? "PO_BILL" : "FIELD_EXPENSE", defaultScope: e.scope ?? "PROJECT", defaultProjectId: e.projectId, purchaseRecordId: e.po, merchantName: e.merchant, receiptNumber: e.receipt, transactionDate: e.date, subtotal: e.dpp, discountAmount: "0", dppAmount: e.dpp, ppnAmount: e.ppn ?? "0", totalAmount: D(e.dpp).plus(e.ppn ?? 0).toFixed(2), paymentMethod: e.paidBy === "EMPLOYEE" ? "PERSONAL" : "BANK_TRANSFER", paidByType: e.paidBy ?? "COMPANY", paidByUserId: e.paidBy === "EMPLOYEE" ? e.creator ?? "u-field" : null, approvalStatus: e.status, settlementStatus: e.settlement ?? (e.paidBy === "EMPLOYEE" ? "PENDING" : "NOT_APPLICABLE"), assignedApproverId: e.approver, submittedAt: e.status === "DRAFT" ? null : new Date(`${e.date}T03:00:00Z`), approvedAt: e.status === "APPROVED" ? new Date(`${e.date}T08:00:00Z`) : null, isPreBaseline: false, ocrStatus: e.status === "DRAFT" ? "NONE" : "DONE", ocrConfidence: e.status === "DRAFT" ? null : "0.912", note: e.note, createdById: e.creator ?? "u-field", clientUuid: `seed-${e.id}` })));
  await db.insert(expenseLines).values(expenseSeed.map((e) => ({ id: `line-${e.id}`, expenseId: e.id, scope: e.scope ?? "PROJECT", projectId: e.projectId, costCategoryId: e.category, budgetLineId: e.budgetLine, description: e.description, quantity: "1", unitCode: "Ls", unitPrice: e.dpp, discountAmount: "0", lineTotal: e.dpp, sortOrder: 0 })));

  const invoiceSeed = [
    { id: "inv-1", projectId: "p-genset", term: "term-g-1", number: "041/INV/EPC/VI/2026", type: "DP", issue: "2026-06-01", due: "2026-06-16", dpp: "1455000000", status: "PAID" },
    { id: "inv-2", projectId: "p-genset", term: "term-g-2", number: "087/INV/EPC/IX/2026", type: "MOS", issue: "2026-09-30", due: "2026-11-15", dpp: "1940000000", status: "PARTIALLY_PAID" },
    { id: "inv-3", projectId: "p-genset", term: "term-g-3", number: "096/INV/EPC/X/2026", type: "PROGRESS", issue: "2026-09-25", due: "2026-10-10", dpp: "485000000", status: "SENT" },
    { id: "inv-4", projectId: "p-lvmdp", term: "term-l-1", number: "102/INV/EPC/IX/2025", type: "DP", issue: "2025-09-20", due: "2025-10-05", dpp: "504000000", status: "PAID" },
    { id: "inv-5", projectId: "p-lvmdp", term: "term-l-2", number: "131/INV/EPC/XII/2025", type: "MOS", issue: "2025-12-15", due: "2025-12-30", dpp: "672000000", status: "PAID" },
    { id: "inv-6", projectId: "p-lvmdp", term: "term-l-4", number: "019/INV/EPC/III/2026", type: "FINAL", issue: "2026-03-06", due: "2026-03-21", dpp: "420000000", status: "PAID" },
    { id: "inv-7", projectId: "p-lvmdp", term: "term-l-5", number: "022/INV/EPC/III/2026", type: "RETENTION", issue: "2026-03-08", due: "2027-03-06", dpp: "84000000", status: "SENT" },
  ];
  await db.insert(customerInvoices).values(invoiceSeed.map((i) => ({ id: i.id, projectId: i.projectId, contractTermId: i.term, number: i.number, type: i.type, issueDate: i.issue, dueDate: i.due, dppAmount: i.dpp, ppnAmount: D(i.dpp).times("0.11").toFixed(2), totalAmount: D(i.dpp).times("1.11").toFixed(2), status: i.status, sentAt: new Date(`${i.issue}T04:00:00Z`) })));
  const paymentSeed = [
    ["pay-1", "inv-1", "2026-06-14", "1455000000", "PPh 4(2) Konstruksi", "TRF/NDC/0614"], ["pay-2", "inv-2", "2026-10-15", "38800000", "PPh 23", "TRF/NDC/1015"],
    ["pay-3", "inv-4", "2025-10-03", "10080000", "PPh 4(2) Konstruksi", "TRF/ARU/1003"], ["pay-4", "inv-5", "2025-12-28", "13440000", "PPh 4(2) Konstruksi", "TRF/ARU/1228"],
    ["pay-5", "inv-6", "2026-03-19", "8400000", "PPh 4(2) Konstruksi", "TRF/ARU/0319"],
  ] as const;
  await db.insert(customerPayments).values(paymentSeed.map(([id, invoiceId, paidDate, withholdingTaxAmount, withholdingTaxType, reference]) => { const invoice = invoiceSeed.find((i) => i.id === invoiceId)!; const total = D(invoice.dpp).times("1.11"); const cash = invoiceId === "inv-2" ? D("1200000000") : total.minus(withholdingTaxAmount); return { id, invoiceId, paidDate, cashReceivedAmount: cash.toFixed(2), withholdingTaxAmount, withholdingTaxType, method: "BANK_TRANSFER", reference, createdById: "u-finance" }; }));

  const scheduleSeed = [
    ["sch-1", "p-genset", "MILESTONE", "Kontrak & kickoff", "2026-05-20", "2026-06-01", "5", "100", "DONE"],
    ["sch-2", "p-genset", "TASK", "Desain SLD, layout & perhitungan beban", "2026-06-01", "2026-06-21", "10", "100", "DONE"],
    ["sch-3", "p-genset", "TASK", "Pengadaan genset dan panel sinkronisasi", "2026-06-05", "2026-09-15", "25", "92", "IN_PROGRESS"],
    ["sch-4", "p-genset", "TASK", "Pondasi, ventilasi dan exhaust", "2026-07-15", "2026-09-30", "12", "100", "DONE"],
    ["sch-5", "p-genset", "TASK", "Instalasi kabel power dan sistem kontrol", "2026-09-01", "2026-11-05", "20", "58", "IN_PROGRESS"],
    ["sch-6", "p-genset", "TASK", "Fuel system dan uji kebocoran", "2026-09-20", "2026-10-28", "8", "70", "IN_PROGRESS"],
    ["sch-7", "p-genset", "MILESTONE", "Loadbank test & commissioning", "2026-10-27", "2026-11-08", "10", "15", "IN_PROGRESS"],
    ["sch-8", "p-genset", "TASK", "Training operator & as-built document", "2026-11-09", "2026-11-25", "5", "0", "NOT_STARTED"],
    ["sch-9", "p-genset", "MILESTONE", "BAST 1", "2026-12-01", "2026-12-18", "5", "0", "NOT_STARTED"],
    ["sch-10", "p-lvmdp", "MILESTONE", "Engineering & pengadaan", "2025-10-01", "2025-12-20", "45", "100", "DONE"],
    ["sch-11", "p-lvmdp", "TASK", "Instalasi & shutdown management", "2026-01-05", "2026-02-15", "35", "100", "DONE"],
    ["sch-12", "p-lvmdp", "MILESTONE", "Commissioning & BAST 1", "2026-02-16", "2026-03-06", "20", "100", "DONE"],
  ] as const;
  await db.insert(scheduleItems).values(scheduleSeed.map(([id, projectId, type, name, plannedStart, plannedEnd, weight, progressPct, status], sortOrder) => ({ id, projectId, type, name, plannedStart, plannedEnd, actualStart: plannedStart, actualEnd: status === "DONE" ? plannedEnd : null, ownerId: "u-pm", weight, progressPct, status, sortOrder })));
  await db.insert(progressUpdates).values([
    { id: "prog-1", scheduleItemId: "sch-5", projectId: "p-genset", reportDate: "2026-10-21", progressPct: "58", quantity: "420", unitCode: "m'", note: "Penarikan kabel panel ke genset 1 selesai; terminasi sisi genset 2 berjalan.", issue: "Akses kerja malam dibatasi sampai pukul 23.00.", createdById: "u-field", clientUuid: "seed-progress-1" },
    { id: "prog-2", scheduleItemId: "sch-7", projectId: "p-genset", reportDate: "2026-10-22", progressPct: "15", note: "Checklist pre-commissioning dan rencana loadbank telah dikirim ke facility.", createdById: "u-field", clientUuid: "seed-progress-2" },
  ]);
  await db.insert(changeOrders).values([
    { id: "co-1", projectId: "p-genset", code: "CO-2026-003", title: "Penambahan fuel polishing system", reason: "Klien mensyaratkan kualitas solar untuk autonomy time 24 jam.", scopeDescription: "1 set fuel polishing 200 L/jam, bypass piping, kontrol dan commissioning.", priceImpact: "185000000", costImpact: "122000000", timeImpactDays: 14, status: "APPROVED", createdById: "u-pm" },
    { id: "co-2", projectId: "p-genset", code: "CO-2026-004", title: "Relokasi titik exhaust sisi timur", reason: "Hasil koordinasi fasad dengan konsultan MK.", scopeDescription: "Perubahan routing exhaust, penambahan support dan insulasi.", priceImpact: "42500000", costImpact: "31000000", timeImpactDays: 3, status: "INTERNAL_REVIEW", createdById: "u-pm" },
  ]);
  await db.insert(punchItems).values([
    { id: "punch-1", projectId: "p-genset", description: "Label kabel kontrol di panel sinkronisasi belum lengkap", isClosed: false },
    { id: "punch-2", projectId: "p-genset", description: "Cat pondasi sisi genset 2 perlu dirapikan setelah instalasi", isClosed: false },
    { id: "punch-3", projectId: "p-lvmdp", description: "Penambahan label danger pada pintu belakang LVMDP", isClosed: true, closedAt: new Date("2026-03-02T04:00:00Z") },
  ]);
  const handoverNames = ["As-Built SLD", "As-Built Layout", "Hasil Uji Insulation/Megger", "Hasil Uji Grounding", "Hasil Uji Beban (Loadbank)", "Manual Book & Kartu Garansi", "BA Training Operator", "BA Commissioning", "BAST 1", "SLO"];
  const handoverRows = ["p-genset", "p-lvmdp"].flatMap((projectId) => handoverNames.map((name, index) => ({ id: `ho-${projectId}-${index + 1}`, projectId, name, isRequired: name !== "SLO", isDone: projectId === "p-lvmdp" ? index < 9 : [0, 2, 3].includes(index), documentId: projectId === "p-lvmdp" && index === 8 ? "doc-bast1" : null })));
  await db.insert(handoverItems).values(handoverRows);

  const pdfBase64 = await makePdf("BERITA ACARA SERAH TERIMA PEKERJAAN (BAST 1)", ["Nomor: 017/BAST/EPC/III/2026", "Proyek: PRJ-2025-009", "Pekerjaan: Modernisasi LVMDP & ATS - DC Cikarang", "Klien: PT Arunika Retail Indonesia", "Tanggal serah terima: 06 Maret 2026", "Masa pemeliharaan: 12 bulan sejak BAST 1", "Pekerjaan telah diperiksa dan diterima dengan catatan punch list tertutup."]);
  await db.insert(fileObjects).values({ id: "file-bast1", storageKey: "projects/p-lvmdp/BAST1-017-2026.pdf", fileName: "BAST1-PRJ-2025-009.pdf", mimeType: "application/pdf", sizeBytes: Math.floor(pdfBase64.length * 0.75), sha256: createHash("sha256").update(Buffer.from(pdfBase64, "base64")).digest("hex"), contentBase64: pdfBase64, uploadedById: "u-pm" });
  await db.insert(documents).values([
    { id: "doc-bast1", projectId: "p-lvmdp", relatedType: "PROJECT", relatedId: "p-lvmdp", category: "BA", title: "BAST 1 — Modernisasi LVMDP & ATS", templateCode: "BAST1", templateVersion: 1, docNumber: "017/BAST/EPC/III/2026", status: "FINAL", fileId: "file-bast1", uploadedById: "u-pm", finalizedAt: new Date("2026-03-06T07:00:00Z"), mergeSnapshot: { projectCode: "PRJ-2025-009", client: "PT Arunika Retail Indonesia", bast1Date: "2026-03-06" }, blocks: [{ type: "heading", text: "BERITA ACARA SERAH TERIMA PEKERJAAN (BAST 1)" }] },
    { id: "doc-report", projectId: "p-genset", relatedType: "PROJECT", relatedId: "p-genset", category: "OTHER", title: "Laporan Progres Mingguan — Minggu 42", templateCode: "PROGRESS_REPORT", status: "DRAFT", uploadedById: "u-pm", mergeSnapshot: { projectCode: "PRJ-2026-014", week: "42", physicalProgress: "65.1%" }, blocks: [{ type: "heading", text: "LAPORAN PROGRES MINGGUAN" }, { type: "paragraph", text: "Pekerjaan instalasi kabel dan persiapan commissioning berjalan sesuai rencana recovery." }] },
  ]);
  await db.insert(activityLogs).values([
    { id: "act-1", actorId: "u-finance", objectType: "EXPENSE", objectId: "exp-2", projectId: "p-genset", action: "APPROVE", changes: [{ field: "approvalStatus", old: "SUBMITTED", new: "APPROVED" }], createdAt: new Date("2026-09-03T02:20:00Z") },
    { id: "act-2", actorId: "u-pm", objectType: "EXPENSE", objectId: "exp-7", projectId: "p-genset", action: "RETURN", reason: "Foto nota belum memperlihatkan nomor dan rincian item.", changes: [{ field: "approvalStatus", old: "SUBMITTED", new: "NEEDS_CORRECTION" }], createdAt: new Date("2026-10-20T06:15:00Z") },
    { id: "act-3", actorId: "u-finance", objectType: "INVOICE", objectId: "inv-2", projectId: "p-genset", action: "PAYMENT_RECORDED", changes: [{ field: "cashReceivedAmount", old: "0", new: "1200000000" }, { field: "withholdingTaxAmount", old: "0", new: "38800000" }], createdAt: new Date("2026-10-15T05:10:00Z") },
    { id: "act-4", actorId: "u-field", objectType: "SCHEDULE_ITEM", objectId: "sch-5", projectId: "p-genset", action: "PROGRESS_UPDATED", changes: [{ field: "progressPct", old: "52", new: "58" }], createdAt: new Date("2026-10-21T10:40:00Z") },
    { id: "act-5", actorId: "u-pm", objectType: "CHANGE_ORDER", objectId: "co-1", projectId: "p-genset", action: "CLIENT_APPROVED", reason: "Persetujuan klien melalui email 14 Oktober 2026.", createdAt: new Date("2026-10-14T03:00:00Z") },
  ]);
  await db.insert(notifications).values([
    { id: "not-1", userId: "u-pm", type: "APPROVAL", title: "1 pengeluaran menunggu persetujuan Anda", body: "Sewa loadbank 800 kW senilai Rp 41.625.000 telah diajukan Rizky.", link: "approvals" },
    { id: "not-2", userId: "u-finance", type: "INVOICE_DUE", title: "Invoice progres melewati jatuh tempo", body: "096/INV/EPC/X/2026 memiliki saldo dan jatuh tempo 10 Oktober 2026.", link: "invoices" },
    { id: "not-3", userId: "u-field", type: "RETURNED", title: "Nota perlu diperbaiki", body: "Lengkapi foto nota Bengkel Las Baja Ringan lalu kirim kembali.", link: "expenses" },
  ]);
}

export async function ensureSeed() {
  if (!seedPromise) seedPromise = seed().catch((error) => { seedPromise = null; throw error; });
  return seedPromise;
}
