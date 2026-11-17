"use client";

import { useMemo, useState } from "react";
import { PackageCheck, Plus, Trash2, X } from "lucide-react";
import type { AppData, BudgetLineView, ChangeOrderView, PoItemView, ProjectView, PurchaseView, TermView } from "@/components/types";
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import { D, formatDate, formatIDR, money, todayJakarta } from "@/lib/format";
import { TERM_STATUSES } from "@/modules/procurement/types";

type Props = { data: AppData; project: ProjectView; onSaved: (message: string) => void };
type PoLineForm = { budgetLineId: string; description: string; quantity: string; unitCode: string; unitAmount: string };

const blankItem = (): PoLineForm => ({ budgetLineId: "", description: "", quantity: "1", unitCode: "Ls", unitAmount: "0" });
const blankPo = () => ({
  supplierName: "", poNumber: "", summary: "", ppnAmount: "0", orderDate: todayJakarta(),
  expectedDate: "", status: "DRAFT", overBudgetReason: "",
});

export default function ProcurementPanel({ data, project, onSaved }: Props) {
  const purchases = useMemo(() => data.purchases.filter((p) => p.projectId === project.id), [data.purchases, project.id]);
  const terms = useMemo(() => data.terms.filter((t) => t.projectId === project.id), [data.terms, project.id]);
  const cos = useMemo(() => data.changeOrders.filter((c) => c.projectId === project.id), [data.changeOrders, project.id]);
  const baselineLines = useMemo(() => data.budgets
    .filter((b) => b.projectId === project.id && b.isActiveBaseline)
    .flatMap((b) => b.lines), [data.budgets, project.id]);
  const projectInvoiced = useMemo(() => data.invoices
    .filter((i) => i.projectId === project.id && i.status !== "CANCELLED")
    .reduce((sum, i) => sum.plus(i.totalAmount), D(0)), [data.invoices, project.id]);
  const contractValue = D(project.contractValueCurrent || 0);

  const canPurchase = data.user.permissions.includes("purchase.edit");
  const canCancelCo = data.user.permissions.includes("changeorder.approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [poOpen, setPoOpen] = useState(false);
  const [poForm, setPoForm] = useState(blankPo());
  const [poLines, setPoLines] = useState<PoLineForm[]>([blankItem()]);
  const [receivePo, setReceivePo] = useState<PurchaseView | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const totalDpp = poLines.reduce((sum, l) => sum.plus(D(l.quantity || 0).times(l.unitAmount || 0)), D(0));
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await fn(); onSaved(message); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal memproses."); }
    finally { setBusy(false); }
  };

  const openPo = () => { setPoForm(blankPo()); setPoLines([blankItem()]); setPoOpen(true); setError(""); };
  const savePo = () => run(async () => {
    await api("/api/purchases", {
      method: "POST",
      body: JSON.stringify({
        ...poForm, projectId: project.id, expectedDate: poForm.expectedDate || null,
        overBudgetReason: poForm.overBudgetReason || undefined,
        items: poLines.map((l, i) => ({
          budgetLineId: l.budgetLineId || null, description: l.description,
          quantity: l.quantity, unitCode: l.unitCode, unitAmount: l.unitAmount, sortOrder: i,
        })),
      }),
    });
    setPoOpen(false);
  }, "PO berbasis pos RAB dibuat.");

  const openReceive = (po: PurchaseView) => {
    setReceivePo(po);
    setReceiveQty(Object.fromEntries(po.items.map((i) => [i.id, i.receivedQty])));
    setError("");
  };
  const saveReceive = () => run(async () => {
    if (!receivePo) return;
    await api(`/api/purchases/${receivePo.id}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: "RECEIVE",
        items: receivePo.items.map((i) => ({ itemId: i.id, receivedQty: receiveQty[i.id] ?? i.receivedQty })),
      }),
    });
    setReceivePo(null);
  }, "Penerimaan barang per pos dicatat.");

  const closePo = (po: PurchaseView) => run(async () => {
    await api(`/api/purchases/${po.id}/action`, { method: "POST", body: JSON.stringify({ to: "CLOSED" }) });
  }, "PO ditutup.");

  const cancelCo = async (co: ChangeOrderView) => {
    const reason = window.prompt("Alasan pembatalan CO (minimal 5 karakter):") || "";
    if (reason.trim().length < 5) { setError("Alasan pembatalan minimal 5 karakter."); return; }
    await run(async () => {
      await api(`/api/change-orders/${co.id}/action`, { method: "POST", body: JSON.stringify({ action: "CANCEL", reason }) });
    }, "CO dibatalkan dan nilai kontrak berjalan diperbarui.");
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-.01em]">PO, Termin &amp; CO</h2>
        <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted">PO tertaut ke baseline RAB, penerimaan dan tagihan dicek per pos, serta pagu termin/kontrak dijaga trigger DB.</p>
      </div>
      {canPurchase ? <Button size="sm" variant="lime" onClick={openPo}><Plus size={14} />Buat PO berbasis pos</Button> : null}
    </div>
    {error ? <div className="rounded-[var(--radius-control)] border border-danger-line bg-danger-bg p-3 text-xs text-danger">{error}</div> : null}

    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Pagu penagihan</h3><p className="mt-0.5 text-[11px] text-muted">Kumulatif invoice aktif dibanding nilai kontrak berjalan.</p></div>
        <Badge value={projectInvoiced.gt(contractValue) ? "OVER_BUDGET" : "ACTIVE"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-control)] bg-paper-2 p-3"><p className="text-[11px] text-muted">Sudah ditagihkan</p><p className="mono mt-1 text-[13px] font-semibold tabular">{formatIDR(projectInvoiced.toFixed(2), true)}</p></div>
        <div className="rounded-[var(--radius-control)] bg-paper-2 p-3"><p className="text-[11px] text-muted">Nilai kontrak berjalan</p><p className="mono mt-1 text-[13px] font-semibold tabular">{formatIDR(contractValue.toFixed(2), true)}</p></div>
        <div className="rounded-[var(--radius-control)] bg-paper-2 p-3"><p className="text-[11px] text-muted">Sisa pagu</p><p className="mono mt-1 text-[13px] font-semibold tabular">{formatIDR(contractValue.minus(projectInvoiced).toFixed(2), true)}</p></div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {terms.length ? terms.map((term) => <TermCard key={term.id} term={term} />) : <EmptyState icon={<PackageCheck />} title="Belum ada termin" description="Struktur termin akan tampil di sini setelah data kontrak diisi." />}
      </div>
    </section>

    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Purchase Order per pos</h3>
      {!purchases.length ? <EmptyState icon={<PackageCheck />} title="Belum ada PO" description="Buat PO berbasis pos RAB untuk mencatat komitmen dan penerimaan." /> : <div className="space-y-3">
        {purchases.map((po) => <article key={po.id} className="rounded-[var(--radius-control)] border border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><Badge value={po.status} /><span className="mono text-[11px] text-muted">{po.poNumber || "Nomor PO belum terbit"}</span></div><h4 className="mt-2 text-[13px] font-semibold">{po.supplierName}</h4><p className="mt-1 text-[11.5px] text-muted">{po.summary}</p><p className="mt-1 text-[11px] text-muted">DPP {formatIDR(po.dppAmount, true)} · Tertagih approved {formatIDR(po.billedAmount, true)}</p></div>
            <div className="flex flex-wrap gap-2">
              {canPurchase && ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status) ? <Button size="sm" variant="secondary" onClick={() => openReceive(po)}><PackageCheck size={14} />Catat penerimaan</Button> : null}
              {canPurchase && po.status === "RECEIVED" ? <Button size="sm" variant="ghost" onClick={() => void closePo(po)}>Tutup PO</Button> : null}
            </div>
          </div>
          {po.items.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[11.5px]"><thead className="text-muted"><tr><th className="pb-2 font-medium">Pos</th><th className="pb-2 font-medium">RAB</th><th className="pb-2 text-right font-medium">Qty</th><th className="pb-2 text-right font-medium">Diterima</th><th className="pb-2 text-right font-medium">Harga satuan</th><th className="pb-2 text-right font-medium">DPP</th></tr></thead><tbody>{po.items.map((item) => <PoItemRow key={item.id} item={item} />)}</tbody></table></div> : <p className="mt-3 rounded-[var(--radius-control)] bg-warn-bg p-3 text-[11.5px] text-warn">PO lama belum memiliki pos. Jalankan migrasi 0003 untuk backfill non-destruktif.</p>}
        </article>)}
      </div>}
    </section>

    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Change order lama (adapter)</h3>
      <p className="mb-3 text-[11.5px] leading-relaxed text-muted">CO lama tetap memengaruhi nilai kontrak lewat trigger S2a. Perubahan baru sebaiknya memakai PTK di tab “RAB &amp; PTK”.</p>
      {!cos.length ? <EmptyState icon={<X />} title="Belum ada CO" description="Data CO lama akan tampil di sini." /> : <div className="space-y-2">{cos.map((co) => <div key={co.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge value={co.status} /><Badge value={co.variationType} tone="info" /><span className="mono text-[11px] text-muted">{co.code}</span></div><p className="mt-1 text-xs font-semibold">{co.title}</p><p className="mt-0.5 text-[11px] text-muted">Harga {formatIDR(co.priceImpact, true)} · waktu {co.timeImpactDays >= 0 ? "+" : ""}{co.timeImpactDays} hari{co.clientReference ? ` · ${co.clientReference}` : ""}</p>{co.cancelReason ? <p className="mt-0.5 text-[11px] text-danger">Dibatalkan: {co.cancelReason}</p> : null}</div>{canCancelCo && ["DRAFT", "INTERNAL_REVIEW", "AWAITING_CLIENT", "APPROVED"].includes(co.status) ? <Button size="sm" variant="danger" loading={busy} onClick={() => void cancelCo(co)}>Batalkan</Button> : null}</div>)}</div>}
    </section>

    <Modal open={poOpen} onClose={() => setPoOpen(false)} title="Buat PO berbasis pos RAB" eyebrow={project.code} wide footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPoOpen(false)}>Batal</Button><Button loading={busy} onClick={() => void savePo()}>Simpan PO</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pemasok"><Input value={poForm.supplierName} onChange={(e) => setPoForm({ ...poForm, supplierName: e.target.value })} /></Field>
        <Field label="Nomor PO" hint="Wajib jika status Dipesan."><Input value={poForm.poNumber} onChange={(e) => setPoForm({ ...poForm, poNumber: e.target.value })} /></Field>
        <Field label="Ringkasan" className="sm:col-span-2"><Textarea value={poForm.summary} onChange={(e) => setPoForm({ ...poForm, summary: e.target.value })} /></Field>
        <Field label="Tanggal order"><Input type="date" value={poForm.orderDate} onChange={(e) => setPoForm({ ...poForm, orderDate: e.target.value })} /></Field>
        <Field label="Perkiraan tiba"><Input type="date" value={poForm.expectedDate} onChange={(e) => setPoForm({ ...poForm, expectedDate: e.target.value })} /></Field>
        <Field label="PPN (IDR)"><Input inputMode="decimal" value={poForm.ppnAmount} onChange={(e) => setPoForm({ ...poForm, ppnAmount: e.target.value })} /></Field>
        <Field label="Status awal"><Select value={poForm.status} onChange={(e) => setPoForm({ ...poForm, status: e.target.value })}><option value="DRAFT">Draft</option><option value="REQUESTED">Diminta</option><option value="ORDERED">Dipesan</option></Select></Field>
        <Field label="Alasan over-pagu" className="sm:col-span-2" hint="Wajib bila salah satu pos melebihi pagu; memerlukan budget.approve."><Textarea value={poForm.overBudgetReason} onChange={(e) => setPoForm({ ...poForm, overBudgetReason: e.target.value })} /></Field>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-[.08em] text-muted">Pos PO</h4><Button size="sm" variant="secondary" onClick={() => setPoLines((old) => [...old, blankItem()])}><Plus size={14} />Tambah pos</Button></div>
        <div className="space-y-3">{poLines.map((line, index) => <div key={index} className="rounded-[var(--radius-control)] border border-line p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">Pos {index + 1}</p>{poLines.length > 1 ? <button aria-label="Hapus pos" onClick={() => setPoLines((old) => old.filter((_, i) => i !== index))} className="text-muted hover:text-danger"><Trash2 size={14} /></button> : null}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Pos RAB baseline" className="sm:col-span-2"><Select value={line.budgetLineId} onChange={(e) => setPoLines((old) => old.map((l, i) => i === index ? { ...l, budgetLineId: e.target.value } : l))}><option value="">Tidak tertaut</option>{baselineLines.map((b: BudgetLineView) => <option key={b.id} value={b.id}>{b.code} · {b.description}</option>)}</Select></Field><Field label="Uraian" className="sm:col-span-2"><Input value={line.description} onChange={(e) => setPoLines((old) => old.map((l, i) => i === index ? { ...l, description: e.target.value } : l))} /></Field><Field label="Volume"><Input inputMode="decimal" value={line.quantity} onChange={(e) => setPoLines((old) => old.map((l, i) => i === index ? { ...l, quantity: e.target.value } : l))} /></Field><Field label="Satuan"><Input value={line.unitCode} onChange={(e) => setPoLines((old) => old.map((l, i) => i === index ? { ...l, unitCode: e.target.value } : l))} /></Field><Field label="Harga satuan"><Input inputMode="decimal" value={line.unitAmount} onChange={(e) => setPoLines((old) => old.map((l, i) => i === index ? { ...l, unitAmount: e.target.value } : l))} /></Field><div className="flex items-end justify-end pb-3 text-xs font-semibold tabular">{formatIDR(money(D(line.quantity || 0).times(line.unitAmount || 0)))}</div></div></div>)}</div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-[var(--radius-control)] bg-ink p-3 text-white"><span className="text-[11px] text-white/60">Total DPP dari pos</span><strong className="text-[15px] tabular">{formatIDR(money(totalDpp))}</strong></div>
    </Modal>

    <Modal open={!!receivePo} onClose={() => setReceivePo(null)} title="Catat penerimaan per pos" eyebrow={receivePo?.poNumber || receivePo?.id} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setReceivePo(null)}>Batal</Button><Button loading={busy} onClick={() => void saveReceive()}>Simpan penerimaan</Button></div>}>
      {receivePo ? <div className="space-y-3">{receivePo.items.map((item) => <div key={item.id} className="rounded-[var(--radius-control)] border border-line p-3"><p className="text-xs font-semibold">{item.budgetLineCode ? `${item.budgetLineCode} · ` : ""}{item.description}</p><p className="mt-1 text-[11px] text-muted">Dipesan {item.quantity} {item.unitCode} · sudah diterima {item.receivedQty}</p><Field label="Qty diterima kumulatif" className="mt-2"><Input inputMode="decimal" value={receiveQty[item.id] ?? item.receivedQty} onChange={(e) => setReceiveQty((old) => ({ ...old, [item.id]: e.target.value }))} /></Field></div>)}</div> : null}
    </Modal>
  </div>;
}

function TermCard({ term }: { term: TermView }) {
  const amount = D(term.amount || 0);
  const invoiced = D(term.invoicedAmount || 0);
  const pct = amount.gt(0) ? Math.min(100, invoiced.div(amount).times(100).toNumber()) : 0;
  const over = invoiced.gt(amount);
  return <div className="rounded-[var(--radius-control)] border border-line p-3">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{term.name}</p><p className="mt-1 text-[11px] text-muted">{term.percent ? `${term.percent}% · ` : ""}target {formatDate(term.targetDate)}</p></div><Badge value={TERM_STATUSES.includes(term.status as (typeof TERM_STATUSES)[number]) ? term.status : "OPEN"} tone={over ? "danger" : term.status === "INVOICED" ? "ok" : term.status === "PARTIALLY_INVOICED" ? "warn" : "neutral"} /></div>
    <div className="mt-3 flex items-baseline justify-between text-[11.5px]"><span className="text-muted">Ditagih {formatIDR(invoiced.toFixed(2), true)}</span><strong className="tabular">{formatIDR(amount.toFixed(2), true)}</strong></div>
    <span className="meter mt-2"><i data-tone={over ? "bad" : "ink"} style={{ width: `${pct}%` }} /></span>
  </div>;
}

function PoItemRow({ item }: { item: PoItemView }) {
  const received = D(item.receivedQty);
  const qty = D(item.quantity);
  return <tr className="border-t border-hairline"><td className="py-2 pr-3 font-medium">{item.description}</td><td className="py-2 pr-3 mono text-[11px] text-muted">{item.budgetLineCode || "—"}</td><td className="py-2 pr-3 text-right tabular">{item.quantity} {item.unitCode}</td><td className={`py-2 pr-3 text-right tabular ${received.gte(qty) ? "text-ok" : received.gt(0) ? "text-warn" : "text-muted"}`}>{item.receivedQty}</td><td className="py-2 pr-3 text-right tabular">{formatIDR(item.unitAmount)}</td><td className="py-2 text-right font-semibold tabular">{formatIDR(item.dppAmount)}</td></tr>;
}
