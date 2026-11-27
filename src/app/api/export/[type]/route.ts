import { companyRoute } from "@/shared/auth/route";
import ExcelJS from "exceljs";
import { ApiError, errorResponse, requireUser } from "@/lib/auth";
import { assertExportAllowed, visibleBudgetTypes } from "@/lib/export-permissions";
import { getWorkspaceData } from "@/lib/workspace";
import { scheduleExportRows } from "@/modules/wbs/service";

async function GETHandler(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const user = await requireUser(); const { type } = await params;
    assertExportAllowed(user, type);
    const data = await getWorkspaceData(user);
    const allowedBudgetTypes = visibleBudgetTypes(user);
    const workbook = new ExcelJS.Workbook(); workbook.creator = "Ardaya EPC"; workbook.created = new Date();
    const sheetName = type === "expenses" ? "Pengeluaran" : type === "invoices" ? "Tagihan" : type === "schedule" ? "Jadwal WBS" : "Anggaran";
    const sheet = workbook.addWorksheet(sheetName);
    if (type === "expenses") {
      sheet.columns = [{ header: "Kode", key: "code", width: 20 }, { header: "Tanggal", key: "date", width: 14 }, { header: "Proyek", key: "project", width: 20 }, { header: "Merchant", key: "merchant", width: 30 }, { header: "Kategori", key: "category", width: 14 }, { header: "Uraian", key: "description", width: 48 }, { header: "Status", key: "status", width: 20 }, { header: "DPP IDR", key: "dpp", width: 18 }, { header: "PPN IDR", key: "ppn", width: 18 }, { header: "Total IDR", key: "total", width: 18 }];
      for (const expense of data.expenses) for (const line of (expense.lines as Record<string, unknown>[])) sheet.addRow({ code: String(expense.code), date: String(expense.transactionDate), project: String(line.projectCode || "OVERHEAD"), merchant: String(expense.merchantName || ""), category: String(line.categoryCode || ""), description: String(line.description), status: String(expense.approvalStatus), dpp: Number(line.lineTotal), ppn: Number(expense.ppnAmount), total: Number(expense.totalAmount) });
    } else if (type === "invoices") {
      sheet.columns = [{ header: "Nomor", key: "number", width: 28 }, { header: "Proyek", key: "project", width: 20 }, { header: "Tipe", key: "type", width: 14 }, { header: "Terbit", key: "issue", width: 14 }, { header: "Jatuh tempo", key: "due", width: 14 }, { header: "DPP", key: "dpp", width: 18 }, { header: "PPN", key: "ppn", width: 18 }, { header: "Total", key: "total", width: 18 }, { header: "Saldo", key: "balance", width: 18 }, { header: "Status", key: "status", width: 20 }];
      data.invoices.forEach((i) => sheet.addRow({ number: String(i.number), project: String(i.projectCode), type: String(i.type), issue: String(i.issueDate), due: String(i.dueDate), dpp: Number(i.dppAmount), ppn: Number(i.ppnAmount), total: Number(i.totalAmount), balance: Number(i.balance), status: String(i.displayStatus) }));
    } else if (type === "schedule") {
      // S5: ekspor WBS seluruh proyek dalam cakupan pengguna, satu sheet per proyek
      // terlalu berat — dipakai kolom proyek + ringkasan Σ bobot di baris atas.
      sheet.columns = [
        { header: "Proyek", key: "project", width: 18 }, { header: "Kode", key: "code", width: 12 },
        { header: "Uraian WBS", key: "name", width: 50 }, { header: "Level", key: "level", width: 8 },
        { header: "Jenis", key: "type", width: 12 }, { header: "Bobot %", key: "weight", width: 10 },
        { header: "Progres %", key: "progress", width: 11 }, { header: "Mulai rencana", key: "plannedStart", width: 14 },
        { header: "Selesai rencana", key: "plannedEnd", width: 15 }, { header: "Status", key: "status", width: 14 },
      ];
      /* `?projectId=` membatasi ekspor ke satu proyek (dipakai tombol di tab
         Jadwal). Tanpa parameter, seluruh proyek dalam cakupan pengguna. */
      const scopedProjectId = new URL(request.url).searchParams.get("projectId");
      const scheduleProjects = scopedProjectId
        ? data.projects.filter((project) => project.id === scopedProjectId)
        : data.projects;
      if (scopedProjectId && !scheduleProjects.length) {
        throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan dalam cakupan Anda.", 404);
      }
      for (const project of scheduleProjects) {
        const { summary, rows } = await scheduleExportRows(String(project.id));
        if (!rows.length) continue;
        sheet.addRow({
          project: `${project.code} · Σ bobot ${summary.activityWeight.toFixed(2)}% (${Math.abs(summary.activityWeight - 100) <= 0.01 ? "lengkap" : "BELUM 100%"})`,
        });
        for (const row of rows) sheet.addRow({ ...row, project: String(project.code) });
      }
    } else {
      // RAB INTERNAL hanya untuk pemegang budget.internal.view.
      const budgets = data.budgets.filter((b) => allowedBudgetTypes.includes(b.type as "CLIENT" | "INTERNAL"));
      sheet.columns = [{ header: "Proyek", key: "project", width: 20 }, { header: "Tipe", key: "type", width: 14 }, { header: "Versi", key: "version", width: 10 }, { header: "Kode Pos", key: "code", width: 15 }, { header: "Kategori", key: "category", width: 14 }, { header: "Uraian", key: "description", width: 50 }, { header: "Volume", key: "quantity", width: 14 }, { header: "Satuan", key: "unit", width: 10 }, { header: "Nilai", key: "total", width: 18 }];
      for (const budget of budgets) for (const line of (budget.lines as Record<string, unknown>[])) sheet.addRow({ project: String(data.projects.find((p) => p.id === budget.projectId)?.code || ""), type: String(budget.type), version: Number(budget.versionNo), code: String(line.code || ""), category: String(line.categoryCode), description: String(line.description), quantity: Number(line.quantity), unit: String(line.unitCode), total: Number(line.total) });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF20332B" } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }; sheet.views = [{ state: "frozen", ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(Buffer.from(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ardaya-${type}-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export const GET = companyRoute(GETHandler);
