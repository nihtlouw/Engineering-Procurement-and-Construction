"use client";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, FileWarning, FolderKanban, Plus, Receipt } from "lucide-react";
import type { AppData, ProjectView } from "@/components/types";
import { Badge, Button, DataTable, EmptyState, SegmentedControl } from "@/components/ui";
import { D, formatDate, formatIDR, todayJakarta } from "@/lib/format";

/* Ikhtisar portofolio — desain v2 "Signal": pita kinerja + tabel padat.
   Tidak ada hero pemasaran atau parallax: yang pertama terlihat adalah pekerjaan. */

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

  /* Kurva kumulatif biaya aktual (disetujui, bukan VOID) sepanjang tahun berjalan.
     Dihitung dari tanggal transaksi di data yang sudah dimuat — bukan estimasi. */
  const curve = buildCumulative(data.expenses);

  const actions = [
    ...overdueInvoices.map((i) => ({ id: i.id, tone: "danger" as const, icon: FileWarning, title: i.number, meta: `${i.projectCode} · saldo ${formatIDR(i.balance)} · tempo ${formatDate(i.dueDate)}`, badge: "OVERDUE", view: "invoices" })),
    ...pending.slice(0, 3).map((e) => ({ id: e.id, tone: "warn" as const, icon: ClipboardCheck, title: e.merchantName || e.code, meta: `${e.code} · ${formatIDR(e.totalAmount)} menunggu ${e.approverName || "approver"}`, badge: "SUBMITTED", view: "approvals" })),
    ...lateItems.slice(0, 3).map((s) => ({ id: s.id, tone: "warn" as const, icon: AlertTriangle, title: s.name, meta: `Rencana selesai ${formatDate(s.plannedEnd)} · progres ${s.progressPct}%`, badge: "AT_RISK", view: "projects" })),
  ].slice(0, 6);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-subtle">Portofolio</p>
          <h1 className="text-[22px] font-semibold tracking-[-.028em] sm:text-[26px]">Ikhtisar portofolio</h1>
          <p className="mt-1 text-[11.5px] text-muted">{projects.length} proyek dalam cakupan · data per {formatDate(new Date())}, {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date())} WIB</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Cakupan proyek" value={scope} onChange={setScope} options={[{ value: "all", label: "Semua" }, { value: "running", label: "Berjalan" }]} />
          {data.user.permissions.includes("expense.create") ? <Button variant="lime" size="sm" onClick={onCreateExpense}><Plus size={14} />Catat biaya</Button> : null}
        </div>
      </div>

      {/* Pita kinerja: satu blok tinta sebagai pusat perhatian layar ini */}
      <section className="band overflow-hidden">
        <div className="grid grid-cols-2 divide-line/0 lg:grid-cols-4">
          <div className="border-b border-white/[.07] p-4 lg:border-b-0 lg:border-r">
            <p className="band-k">Kontrak berjalan</p>
            <p className="band-v">{formatIDR(contract.toFixed(2), true)}</p>
            <p className="band-f">{projects.length} proyek · termasuk CO disetujui</p>
          </div>
          <div className="border-b border-white/[.07] p-4 lg:border-b-0 lg:border-r">
            <p className="band-k">Biaya aktual</p>
            <p className="band-v">{formatIDR(actual.toFixed(2), true)} <span className="text-[12px] font-medium text-[#98a49d]">{contract.gt(0) ? `${actual.div(contract).times(100).toFixed(1)}%` : ""}</span></p>
            <p className="band-f">{pending.length ? <><b>{pending.length} pengajuan</b> menunggu persetujuan</> : "seluruh biaya sudah final"}</p>
          </div>
          <div className="border-b border-white/[.07] p-4 sm:border-b-0 lg:border-r">
            <p className="band-k">Piutang</p>
            <p className="band-v">{formatIDR(receivable.toFixed(2), true)}</p>
            <p className="band-f">{overdue.gt(0) ? <span className="font-semibold text-[#ff9d8f]">{formatIDR(overdue.toFixed(2), true)} lewat jatuh tempo</span> : "tidak ada yang terlambat"}</p>
          </div>
          <div className="p-4">
            <p className="band-k">Sisa komitmen PO</p>
            <p className="band-v">{formatIDR(openCommitment.toFixed(2), true)}</p>
            <p className="band-f">margin indikatif <b>{formatIDR(margin.toFixed(2), true)}</b> · {marginPct.toFixed(1)}%</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[.07] px-4 py-2 text-[10px] text-[#7d8a83]">
          <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-lime" />{projects.length} proyek berjalan</span>
          <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[#ff9d8f]" />{overdueInvoices.length} invoice terlambat</span>
          <span className="flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[#c9cfc6]" />{data.expenses.length} nota tercatat</span>
          <span className="ml-auto mono hidden sm:inline">sumber: data proyek dalam cakupan Anda</span>
        </div>
      </section>

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
                  <button onClick={() => onNavigate(a.view)} className="edge flex w-full items-center gap-3 border-b border-hairline py-2.5 pl-3 pr-4 text-left last:border-0 hover:bg-paper" data-tone={a.tone === "danger" ? "danger" : "warn"}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{a.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{a.meta}</span>
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

        <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Biaya aktual kumulatif</h2>
              <p className="mt-0.5 text-[11px] text-muted">Akumulasi biaya disetujui {curve.year} vs garis kontrak</p>
            </div>
            <div className="text-right">
              <p className="mono text-[17px] font-semibold tracking-[-.03em] text-ink">{formatIDR(curve.total, true)}</p>
              <p className="text-[10.5px] text-muted">{contract.gt(0) ? `${D(curve.total).div(contract).times(100).toFixed(1)}% dari kontrak` : "belum ada kontrak"}</p>
            </div>
          </header>
          <CumulativeChart curve={curve} />
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
            <DataTable
              density="compact"
              minWidth={560}
              rows={recentExpenses}
              rowKey={(e) => e.id}
              onRowClick={() => onNavigate("expenses")}
              columns={[
                { key: "code", header: "Kode", width: "112px", cell: (e) => <span className="mono text-[11px] text-muted">{e.code}</span> },
                { key: "merchant", header: "Merchant", cell: (e) => <span className="block max-w-[190px] truncate font-medium">{e.merchantName || "Tanpa merchant"}</span> },
                { key: "total", header: "Total", align: "right", width: "132px", cell: (e) => <span className="mono">{formatIDR(e.totalAmount)}</span> },
                { key: "status", header: "Status", width: "132px", cell: (e) => <Badge value={e.approvalStatus} /> },
                { key: "date", header: "Tanggal", align: "right", width: "96px", cell: (e) => <span className="mono text-[11px] text-muted">{formatDate(e.transactionDate)}</span> },
              ]}
            />
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
          <p className="mono text-[11px] tracking-[.02em] text-subtle">{project.code}</p>
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
          <div className="flex items-baseline justify-between text-[10.5px] text-muted"><span>Progres fisik</span><span className="mono font-semibold text-ink">{progress}%</span></div>
          <div className="meter mt-1"><i data-tone="ink" style={{ width: `${Math.min(100, progress)}%` }} /></div>
        </div>
        <div>
          <div className="flex items-baseline justify-between text-[10.5px] text-muted"><span>Anggaran terpakai</span><span className={`mono font-semibold ${used > 100 ? "text-danger" : used > 90 ? "text-warn" : "text-ink"}`}>{used.toFixed(0)}%</span></div>
          <div className="meter mt-1"><i data-tone={used > 100 ? "bad" : used > 90 ? "warn" : "pending"} style={{ width: `${Math.min(100, used)}%` }} /></div>
        </div>
      </div>
    </button>
  );
}

/* --- Grafik kumulatif: SVG sebaris, tanpa aset jaringan eksternal -------------
 * Sumbu Y memakai biaya aktual kumulatif saja (bukan nilai kontrak) supaya
 * kurva terbaca; garis kontrak ditampilkan sebagai konteks di baris atas.
 */
type CurvePoint = { label: string; value: number };

function buildCumulative(expenses: AppData["expenses"]) {
  /* Basis sama dengan calculateProjectMetrics: baris scope PROJECT saja, memakai
     lineTotal (DPP tanpa PPN) dan hanya nota berstatus APPROVED. Overhead tidak
     pernah dihitung sebagai biaya aktual proyek. */
  const year = new Date().getFullYear();
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const buckets = months.map((label) => ({ label, value: 0 }));
  for (const e of expenses) {
    if (e.approvalStatus !== "APPROVED") continue;
    const d = new Date(e.transactionDate);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const amount = e.lines.filter((l) => l.scope === "PROJECT").reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
    if (amount > 0) buckets[d.getMonth()].value += amount;
  }
  let running = 0;
  const points: CurvePoint[] = buckets.slice(0, new Date().getMonth() + 1).map((b) => {
    running += b.value;
    return { label: b.label, value: running };
  });
  return { year, points, total: running };
}

function CumulativeChart({ curve }: { curve: ReturnType<typeof buildCumulative> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 100, H = 34, pad = 2;
  const max = Math.max(...curve.points.map((p) => p.value), 1);
  const pts = curve.points.map((p, i) => {
    const x = curve.points.length === 1 ? W : (i / (curve.points.length - 1)) * W;
    const y = H - pad - (p.value / max) * (H - pad * 2);
    return { ...p, x, y };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(2)} ${H} L${pts[0].x.toFixed(2)} ${H} Z`;
  const last = pts[pts.length - 1];
  const active = hover !== null ? pts[hover] : last;
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex items-baseline justify-between text-[10.5px] text-muted">
        <span className="mono font-semibold text-ink">{formatIDR(active.value.toFixed(2), true)}</span>
        <span>{active.label} {curve.year}</span>
      </div>
      <div className="relative mt-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[92px] w-full overflow-visible" role="img" aria-label={`Kurva kumulatif biaya aktual ${curve.year}`}>
          <defs>
            <linearGradient id="cum-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity=".16" />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--color-hairline)" strokeWidth=".35" vectorEffect="non-scaling-stroke" />)}
          <path d={area} fill="url(#cum-fill)" />
          <path d={line} fill="none" stroke="var(--color-ink)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <g key={p.label}>
              <circle cx={p.x} cy={p.y} r={hover === i ? 1.6 : 1} fill={hover === i ? "var(--color-lime-bright)" : "var(--color-ink)"} stroke="var(--color-surface)" strokeWidth=".5" vectorEffect="non-scaling-stroke" />
              <rect x={p.x - W / (pts.length * 2)} y={0} width={W / pts.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          ))}
        </svg>
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[.06em] text-subtle">
          {pts.map((p, i) => <span key={p.label} className={i === pts.length - 1 ? "font-semibold text-ink" : ""}>{p.label}</span>)}
        </div>
      </div>
    </div>
  );
}
