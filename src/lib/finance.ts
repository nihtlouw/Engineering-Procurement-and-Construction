import Decimal from "decimal.js";
import { D, money, todayJakarta } from "@/lib/format";
import type { CloseCheck, ProjectMetric } from "@/lib/domain";

type Expense = { id: string; approvalStatus: string; purchaseRecordId: string | null; defaultProjectId: string | null; paidByType: string; totalAmount: string; lines?: { projectId: string | null; scope: string; lineTotal: string }[] };
type Purchase = { id: string; projectId: string; status: string; dppAmount: string };
type Invoice = { id: string; projectId: string; type: string; status: string; totalAmount: string; dueDate: string; payments?: { cashReceivedAmount: string; withholdingTaxAmount: string }[] };
type Project = { id: string; contractValue: string; retentionPct: string; bast1Date: string | null; bast2Date: string | null };
type Budget = { id: string; projectId: string; type: string; status: string; isActiveBaseline: boolean; total: string };

const committed = (status: string) => ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(status);
const billed = (status: string) => ["SENT", "PARTIALLY_PAID", "PAID"].includes(status);

export function invoiceBalance(invoice: Invoice) {
  const paid = (invoice.payments ?? []).reduce((sum, p) => sum.plus(p.cashReceivedAmount).plus(p.withholdingTaxAmount), D(0));
  return D(invoice.totalAmount).minus(paid);
}

export function displayInvoiceStatus(invoice: Invoice) {
  if (["CANCELLED", "DRAFT", "APPROVED_INTERNAL"].includes(invoice.status)) return invoice.status;
  const balance = invoiceBalance(invoice);
  if (balance.lte(0)) return "PAID";
  if (balance.gt(0) && invoice.dueDate < todayJakarta()) return "OVERDUE";
  return balance.lt(invoice.totalAmount) ? "PARTIALLY_PAID" : invoice.status;
}

export function calculateProjectMetrics(input: {
  project: Project; expenses: Expense[]; purchases: Purchase[]; invoices: Invoice[]; budgets: Budget[];
  changeOrders: { projectId: string; status: string; priceImpact: string }[];
  schedule: { projectId: string; weight: string; progressPct: string }[]; canViewInternal: boolean;
}): ProjectMetric {
  const { project } = input;
  const expenses = input.expenses.filter((e) => (e.lines ?? []).some((l) => l.projectId === project.id));
  const sumCost = (statuses: string[]) => expenses.filter((e) => statuses.includes(e.approvalStatus)).reduce(
    (sum, e) => sum.plus((e.lines ?? []).filter((l) => l.projectId === project.id && l.scope === "PROJECT").reduce((s, l) => s.plus(l.lineTotal), D(0))), D(0));
  const actualCost = sumCost(["APPROVED"]);
  const pendingCost = sumCost(["SUBMITTED", "NEEDS_CORRECTION"]);
  const projectPurchases = input.purchases.filter((p) => p.projectId === project.id);
  const approvedPoBills = expenses.filter((e) => e.approvalStatus === "APPROVED" && e.purchaseRecordId);
  const remainingCommitment = projectPurchases.filter((p) => committed(p.status)).reduce((sum, po) => {
    const poBills = approvedPoBills.filter((e) => e.purchaseRecordId === po.id).reduce(
      (s, e) => s.plus((e.lines ?? []).filter((l) => l.projectId === project.id).reduce((x, l) => x.plus(l.lineTotal), D(0))), D(0));
    return sum.plus(Decimal.max(D(po.dppAmount).minus(poBills), 0));
  }, D(0));
  const commitment = projectPurchases.filter((p) => committed(p.status)).reduce((sum, p) => sum.plus(p.dppAmount), D(0));
  const changes = input.changeOrders.filter((c) => c.projectId === project.id && ["APPROVED", "IMPLEMENTED"].includes(c.status));
  const contractValueCurrent = changes.reduce((sum, c) => sum.plus(c.priceImpact), D(project.contractValue));
  const projectInvoices = input.invoices.filter((i) => i.projectId === project.id);
  const invoiced = projectInvoices.filter((i) => billed(i.status) || i.status === "PAID").reduce((sum, i) => sum.plus(i.totalAmount), D(0));
  const received = projectInvoices.reduce((sum, i) => sum.plus((i.payments ?? []).reduce((s, p) => s.plus(p.cashReceivedAmount).plus(p.withholdingTaxAmount), D(0))), D(0));
  const overdue = projectInvoices.filter((i) => displayInvoiceStatus(i) === "OVERDUE").reduce((sum, i) => sum.plus(invoiceBalance(i)), D(0));
  const retentionInvoiced = projectInvoices.filter((i) => i.type === "RETENTION").reduce((sum, i) => sum.plus((i.payments ?? []).reduce((s, p) => s.plus(p.cashReceivedAmount).plus(p.withholdingTaxAmount), D(0))), D(0));
  const retentionOutstanding = Decimal.max(D(project.retentionPct).div(100).times(contractValueCurrent).minus(retentionInvoiced), 0);
  const schedule = input.schedule.filter((s) => s.projectId === project.id);
  const weight = schedule.reduce((sum, s) => sum.plus(s.weight), D(0));
  const progress = weight.gt(0) ? schedule.reduce((sum, s) => sum.plus(D(s.weight).times(s.progressPct)), D(0)).div(weight) : D(0);
  const forecastExposure = actualCost.plus(pendingCost).plus(remainingCommitment);
  const baseline = input.budgets.find((b) => b.projectId === project.id && b.type === "INTERNAL" && b.isActiveBaseline);
  const result: ProjectMetric = {
    actualCost: money(actualCost), pendingCost: money(pendingCost), commitment: money(commitment), remainingCommitment: money(remainingCommitment),
    contractValueCurrent: money(contractValueCurrent), forecastExposure: money(forecastExposure), invoiced: money(invoiced), received: money(received),
    receivable: money(Decimal.max(invoiced.minus(received), 0)), overdue: money(overdue), retentionOutstanding: money(retentionOutstanding),
    progressPct: progress.toDecimalPlaces(1).toNumber(),
  };
  if (input.canViewInternal) {
    const baselineInternal = D(baseline?.total ?? 0);
    result.baselineInternal = money(baselineInternal);
    result.remainingBudget = money(baselineInternal.minus(actualCost));
    result.indicativeMargin = money(contractValueCurrent.minus(forecastExposure));
  }
  return result;
}

export function buildCloseCheck(input: {
  projectId: string; invoices: Invoice[]; expenses: Expense[]; punchItems: { projectId: string; isClosed: boolean }[];
  handoverItems: { projectId: string; isRequired: boolean; isDone: boolean; name: string }[];
}): CloseCheck[] {
  const retentionBalance = input.invoices.filter((i) => i.projectId === input.projectId && i.type === "RETENTION" && i.status !== "CANCELLED").reduce((s, i) => s.plus(Decimal.max(invoiceBalance(i), 0)), D(0));
  const pending = input.expenses.filter((e) => (e.lines ?? []).some((l) => l.projectId === input.projectId) && ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"].includes(e.approvalStatus));
  const punches = input.punchItems.filter((p) => p.projectId === input.projectId && !p.isClosed);
  const requiredDocs = input.handoverItems.filter((h) => h.projectId === input.projectId && h.isRequired && !h.isDone);
  return [
    { key: "retention", label: "Retensi telah diselesaikan", ok: retentionBalance.lte(0), detail: retentionBalance.lte(0) ? "Tidak ada saldo retensi" : `Saldo retensi ${money(retentionBalance)}` },
    { key: "expenses", label: "Tidak ada biaya menunggu proses", ok: pending.length === 0, detail: pending.length ? `${pending.length} pengeluaran belum final` : "Seluruh biaya sudah final" },
    { key: "punch", label: "Punch list sudah tertutup", ok: punches.length === 0, detail: punches.length ? `${punches.length} item masih terbuka` : "Semua item selesai" },
    { key: "documents", label: "Dokumen wajib serah terima lengkap", ok: requiredDocs.length === 0, detail: requiredDocs.length ? `${requiredDocs.length} dokumen belum lengkap` : "Checklist wajib lengkap" },
  ];
}
