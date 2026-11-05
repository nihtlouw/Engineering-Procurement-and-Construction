"use client";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, FileWarning, FolderKanban, Plus, Receipt } from "lucide-react";
import type { AppData, ProjectView } from "@/components/types";
import { Badge, Button, EmptyState, SegmentedControl } from "@/components/ui";
import { D, formatDate, formatIDR, todayJakarta } from "@/lib/format";

/* Ikhtisar portofolio — rencana desain v1 bab 06.
   Tidak ada hero pemasaran, parallax, atau tombol gulir: yang pertama terlihat adalah pekerjaan. */

export default function Dashboard({ data, onOpenProject, onCreateExpense, onNavigate }: { data: AppData; onOpenProject: (id: string) => void; onCreateExpense: () => void; onNavigate: (view: string) => void }) {
  const [scope, setScope] = useState<"all" | "running">("all");
  const metrics = Object.values(data.metrics);
  const projects = scope === "running" ? data.projects.filter((p) => ["IN_PROGRESS", "ACTIVE", "RUNNING"].includes(p.stage)) : data.projects;
  const sum = (key: "contractValueCurrent" | "actualCost" | "received" | "receivable" | "overdue" | "forecastExposure") => metrics.reduce((s, m) => s.plus(m[key] || 0), D(0));

  const contract = sum("contractValueCurrent");
  const actual = sum("actualCost");
  const receivable = sum("receivable");
  const overdue = sum("overdue");
  const margin = contract.minus(actual);
  const marginPct = contract.gt(0) ? margin.div(contract).times(100).toNumber() : 0;
  const openCommitment = data.purchases.filter((p) => ["ORDERED", "PARTIAL", "APPROVED"].includes(p.status)).reduce((s, p) => s.plus(p.remainingAmount || 0), D(0));

  const pending = data.expenses.filter((e) => e.approvalStatus === "SUBMITTED");
  const overdueInvoices = data.invoices.filter((i) => i.displayStatus === "OVERDUE");
  const today = todayJakarta();
  const lateItems = data.schedule.filter((s) => s.plannedEnd && s.plannedEnd < today && s.status !== "DONE");
  const recentExpenses = [...data.expenses].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1)).slice(0, 5);

  const actions = [
    ...overdueInvoices.map((i) => ({ id: i.id, tone: "danger" as const, icon: FileWarning, title: i.number, meta: `${i.projectCode} · saldo ${formatIDR(i.balance)} · tempo ${formatDate(i.dueDate)}`, badge: "OVERDUE", view: "invoices" })),
    ...pending.slice(0, 3).map((e) => ({ id: e.id, tone: "warn" as const, icon: ClipboardCheck, title: e.merchantName || e.code, meta: `${e.code} · ${formatIDR(e.totalAmount)} menunggu ${e.approverName || "approver"}`, badge: "SUBMITTED", view: "approvals" })),
    ...lateItems.slice(0, 3).map((s) => ({ id: s.id, tone: "warn" as const, icon: AlertTriangle, title: s.name, meta: `Rencana selesai ${formatDate(s.plannedEnd)} · progres ${s.progressPct}%`, badge: "AT_RISK", view: "projects" })),
  ].slice(0, 6);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-[-.025em] sm:text-[25px]">Ikhtisar portofolio</h1>
          <p className="mt-1 text-[12.5px] text-muted">{projects.length} proyek · data per {formatDate(new Date())}, {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date())} WIB</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Cakupan proyek" value={scope} onChange={setScope} options={[{ value: "all", label: "Semua" }, { value: "running", label: "Berjalan" }]} />
          {data.user.permissions.includes("expense.create") ? <Button variant="lime" size="sm" onClick={onCreateExpense}><Plus size={14} />Catat biaya</Button> : null}
        </div>
      </div>

      {/* Baris KPI */}
      <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b border-hairline p-4 xl:border-b-0 xl:border-r">
          <p className="text-[11.5px] font-semibold text-muted">Biaya aktual</p>
          <p className="mt-1.5 text-[22px] font-semibold tracking-[-.025em] tabular sm:text-[25px]">{formatIDR(actual.toFixed(2), true)}</p>
          <p className="mt-1 text-[11.5px] text-muted">dari kontrak {formatIDR(contract.toFixed(2), true)}</p>
        </div>
        <div className="border-b border-hairline p-4 xl:border-b-0 xl:border-r">
          <p className="text-[11.5px] font-semibold text-muted">Piutang</p>
          <p className="mt-1.5 text-[22px] font-semibold tracking-[-.025em] tabular sm:text-[25px]">{formatIDR(receivable.toFixed(2), true)}</p>
          <p className="mt-1 text-[11.5px] text-muted">{overdue.gt(0) ? <><strong className="font-semibold text-danger">{formatIDR(overdue.toFixed(2), true)}</strong> lewat jatuh tempo</> : "tidak ada yang terlambat"}</p>
        </div>
        <div className="border-b border-hairline p-4 sm:border-b-0 sm:border-r">
          <p className="text-[11.5px] font-semibold text-muted">Sisa komitmen PO</p>
          <p className="mt-1.5 text-[22px] font-semibold tracking-[-.025em] tabular sm:text-[25px]">{formatIDR(openCommitment.toFixed(2), true)}</p>
          <p className="mt-1 text-[11.5px] text-muted">belum ditagihkan supplier</p>
        </div>
        <div className="p-4">
          <p className="text-[11.5px] font-semibold text-muted">Margin indikatif</p>
          <p className={`mt-1.5 text-[22px] font-semibold tracking-[-.025em] tabular sm:text-[25px] ${margin.lt(0) ? "text-danger" : ""}`}>{formatIDR(margin.toFixed(2), true)}</p>
          <p className="mt-1 text-[11.5px] text-muted"><strong className={`font-semibold ${marginPct < 10 ? "text-danger" : "text-ok"}`}>{marginPct.toFixed(1)}%</strong> terhadap nilai kontrak</p>
        </div>
      </div>

      {/* Perlu tindakan + portofolio */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">Perlu tindakan</h2>
            <span className="text-[11.5px] text-muted">{actions.length ? `${actions.length} item` : "bersih"}</span>
          </header>
          {actions.length ? (
            <ul>
              {actions.map((a) => (
                <li key={a.id}>
                  <button onClick={() => onNavigate(a.view)} className="flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left last:border-0 hover:bg-paper">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] ${a.tone === "danger" ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn"}`}><a.icon size={14} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold">{a.title}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">{a.meta}</span>
                    </span>
                    <Badge value={a.badge} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-4 py-8 text-[12.5px] text-muted"><CheckCircle2 size={15} className="text-ok" />Tidak ada risiko terbuka pada cakupan Anda.</div>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">Portofolio</h2>
            <button onClick={() => onNavigate("projects")} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">Semua proyek<ArrowRight size={12} /></button>
          </header>
          {projects.length ? projects.map((project) => <PortfolioRow key={project.id} project={project} data={data} onClick={() => onOpenProject(project.id)} />) : <EmptyState icon={<FolderKanban size={16} />} title="Belum ada proyek berjalan" description="Proyek yang sudah dikonversi dari peluang akan muncul di sini." />}
        </section>
      </div>

      {/* Pengeluaran terbaru + pipeline */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">Pengeluaran terbaru</h2>
            <button onClick={() => onNavigate("expenses")} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted hover:text-ink">Buku biaya<ArrowRight size={12} /></button>
          </header>
          {recentExpenses.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-sunken text-left text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
                    <th className="px-4 py-2">Kode</th>
                    <th className="px-3 py-2">Merchant</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {recentExpenses.map((e) => (
                    <tr key={e.id} className="border-t border-hairline hover:bg-paper">
                      <td className="mono whitespace-nowrap px-4 py-2.5 text-[11.5px] text-muted">{e.code}</td>
                      <td className="max-w-[190px] truncate px-3 py-2.5 font-medium">{e.merchantName || "Tanpa merchant"}</td>
                      <td className="mono whitespace-nowrap px-3 py-2.5 text-right">{formatIDR(e.totalAmount)}</td>
                      <td className="px-3 py-2.5"><Badge value={e.approvalStatus} /></td>
                      <td className="mono whitespace-nowrap px-4 py-2.5 text-right text-[11.5px] text-muted">{formatDate(e.transactionDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={<Receipt size={16} />} title="Belum ada pengeluaran" description="Nota lapangan yang dicatat akan tampil di sini beserta status persetujuannya." />}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="border-b border-line px-4 py-3"><h2 className="text-[13px] font-semibold">Pipeline peluang</h2></header>
          {data.opportunities.length ? (
            <div>
              {data.opportunities.slice(0, 5).map((o) => (
                <div key={o.id} className="border-b border-hairline px-4 py-2.5 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold">{o.title}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-muted">{o.clientName}</p>
                    </div>
                    <Badge value={o.status} />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between">
                    <span className="mono text-[11px] text-subtle">{o.code}</span>
                    <span className="mono text-[12px] font-semibold">{formatIDR(o.estimatedValue, true)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="px-4 py-6 text-[12.5px] text-muted">Pipeline tidak tersedia untuk peran Anda.</p>}
        </section>
      </div>
    </div>
  );
}

function PortfolioRow({ project, data, onClick }: { project: ProjectView; data: AppData; onClick: () => void }) {
  const m = data.metrics[project.id];
  const budget = m?.baselineInternal ? D(m.baselineInternal) : D(0);
  const used = budget.gt(0) ? D(m?.actualCost || 0).div(budget).times(100).toNumber() : 0;
  const progress = m?.progressPct ?? 0;
  return (
    <button onClick={onClick} className="block w-full border-b border-hairline px-4 py-3 text-left last:border-0 hover:bg-paper">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono text-[10.5px] tracking-[.02em] text-subtle">{project.code}</p>
          <p className="mt-0.5 truncate text-[12.5px] font-semibold">{project.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted">{project.clientName}{project.siteName ? ` · ${project.siteName}` : ""}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="mono text-[12px] font-semibold">{formatIDR(m?.contractValueCurrent, true)}</p>
          <div className="mt-1 flex justify-end"><Badge value={project.stage} /></div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div>
          <div className="flex items-baseline justify-between text-[11px] text-muted"><span>Progres fisik</span><span className="mono font-semibold text-ink">{progress}%</span></div>
          <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-paper-2"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, progress)}%` }} /></div>
        </div>
        <div>
          <div className="flex items-baseline justify-between text-[11px] text-muted"><span>Anggaran terpakai</span><span className={`mono font-semibold ${used > 100 ? "text-danger" : used > 90 ? "text-warn" : "text-ink"}`}>{used.toFixed(0)}%</span></div>
          <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-paper-2"><div className={`h-full rounded-full ${used > 100 ? "bg-danger" : used > 90 ? "bg-warn" : "bg-ink-500"}`} style={{ width: `${Math.min(100, used)}%` }} /></div>
        </div>
      </div>
    </button>
  );
}
