import ExcelJS from "exceljs";
import { errorResponse, requireUser } from "@/lib/auth";
import { getWorkspaceData } from "@/lib/workspace";

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const user = await requireUser(); const { type } = await params; const data = await getWorkspaceData(user);
    if (!["expenses", "invoices", "budget"].includes(type)) return Response.json({ code: "UNKNOWN_EXPORT", message: "Jenis ekspor tidak dikenal." }, { status: 404 });
    if (type === "expenses" && !data.expenses.length && !user.permissions.includes("expense.view.project")) return Response.json({ code: "FORBIDDEN", message: "Tidak ada data yang dapat diekspor." }, { status: 403 });
    const workbook = new ExcelJS.Workbook(); workbook.creator = "Ardaya EPC"; workbook.created = new Date();
    const sheet = workbook.addWorksheet(type === "expenses" ? "Pengeluaran" : type === "invoices" ? "Tagihan" : "Anggaran");
    if (type === "expenses") {
      sheet.columns = [{ header: "Kode", key: "code", width: 20 }, { header: "Tanggal", key: "date", width: 14 }, { header: "Proyek", key: "project", width: 20 }, { header: "Merchant", key: "merchant", width: 30 }, { header: "Kategori", key: "category", width: 14 }, { header: "Uraian", key: "description", width: 48 }, { header: "Status", key: "status", width: 20 }, { header: "DPP IDR", key: "dpp", width: 18 }, { header: "PPN IDR", key: "ppn", width: 18 }, { header: "Total IDR", key: "total", width: 18 }];
      for (const expense of data.expenses) for (const line of (expense.lines as Record<string, unknown>[])) sheet.addRow({ code: String(expense.code), date: String(expense.transactionDate), project: String(line.projectCode || "OVERHEAD"), merchant: String(expense.merchantName || ""), category: String(line.categoryCode || ""), description: String(line.description), status: String(expense.approvalStatus), dpp: Number(line.lineTotal), ppn: Number(expense.ppnAmount), total: Number(expense.totalAmount) });
    } else if (type === "invoices") {
      sheet.columns = [{ header: "Nomor", key: "number", width: 28 }, { header: "Proyek", key: "project", width: 20 }, { header: "Tipe", key: "type", width: 14 }, { header: "Terbit", key: "issue", width: 14 }, { header: "Jatuh tempo", key: "due", width: 14 }, { header: "DPP", key: "dpp", width: 18 }, { header: "PPN", key: "ppn", width: 18 }, { header: "Total", key: "total", width: 18 }, { header: "Saldo", key: "balance", width: 18 }, { header: "Status", key: "status", width: 20 }];
      data.invoices.forEach((i) => sheet.addRow({ number: String(i.number), project: String(i.projectCode), type: String(i.type), issue: String(i.issueDate), due: String(i.dueDate), dpp: Number(i.dppAmount), ppn: Number(i.ppnAmount), total: Number(i.totalAmount), balance: Number(i.balance), status: String(i.displayStatus) }));
    } else {
      sheet.columns = [{ header: "Proyek", key: "project", width: 20 }, { header: "Tipe", key: "type", width: 14 }, { header: "Versi", key: "version", width: 10 }, { header: "Kode Pos", key: "code", width: 15 }, { header: "Kategori", key: "category", width: 14 }, { header: "Uraian", key: "description", width: 50 }, { header: "Volume", key: "quantity", width: 14 }, { header: "Satuan", key: "unit", width: 10 }, { header: "Nilai", key: "total", width: 18 }];
      for (const budget of data.budgets) for (const line of (budget.lines as Record<string, unknown>[])) sheet.addRow({ project: String(data.projects.find((p) => p.id === budget.projectId)?.code || ""), type: String(budget.type), version: Number(budget.versionNo), code: String(line.code || ""), category: String(line.categoryCode), description: String(line.description), quantity: Number(line.quantity), unit: String(line.unitCode), total: Number(line.total) });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF20332B" } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }; sheet.views = [{ state: "frozen", ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(Buffer.from(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ardaya-${type}-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
