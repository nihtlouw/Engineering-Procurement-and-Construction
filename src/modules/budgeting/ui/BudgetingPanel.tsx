"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AppData, BudgetView, ProjectView, VariationOrderView } from "@/components/types";
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import { LABELS } from "@/lib/domain";
import { D, formatIDR, money } from "@/lib/format";
import { evaluatePagu, lineTotal } from "@/modules/budgeting/pagu";

type Props = { data: AppData; project: ProjectView; onSaved: (message: string) => void };
type LineForm = {
  code: string; costCategoryId: string; description: string; quantity: string;
  unitCode: string; unitAmount: string; contingencyPct: string; wbsItemId: string; keywords: string;
};
type VariationLineForm = {
  action: "ADD" | "OMIT" | "ADJUST"; budgetType: "CLIENT" | "INTERNAL"; budgetLineId: string;
  description: string; quantity: string; unitCode: string; unitAmount: string;
  priceAmount: string; costAmount: string;
};

const blankLine = (): LineForm => ({
  code: "", costCategoryId: "", description: "", quantity: "1", unitCode: "Ls",
  unitAmount: "0", contingencyPct: "0", wbsItemId: "", keywords: "",
});
const blankVariationLine = (): VariationLineForm => ({
  action: "ADD", budgetType: "INTERNAL", budgetLineId: "", description: "",
  quantity: "1", unitCode: "Ls", unitAmount: "0", priceAmount: "0", costAmount: "0",
});

export default function BudgetingPanel({ data, project, onSaved }: Props) {
  const versions = useMemo(() => data.budgets.filter((b) => b.projectId === project.id), [data.budgets, project.id]);
  const variations = useMemo(() => data.variationOrders.filter((v) => v.projectId === project.id), [data.variationOrders, project.id]);
  const baselines = versions.filter((b) => b.isActiveBaseline);
  const canEdit = data.user.permissions.includes("budget.edit");
  const canApprove = data.user.permissions.includes("budget.approve");
  const canVariation = data.user.permissions.includes("variation.edit");
  const canVariationApprove = data.user.permissions.includes("variation.approve");
  const canInternal = data.user.permissions.includes("budget.internal.view");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetView | null>(null);
  const [budgetType, setBudgetType] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [revisionNote, setRevisionNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([blankLine()]);
  const [variationOpen, setVariationOpen] = useState(false);
  const [vType, setVType] = useState<"ADD" | "OMIT" | "SUBSTITUTE">("ADD");
  const [vForm, setVForm] = useState({ title: "", reason: "", scopeDescription: "", timeImpactDays: "0", clientReference: "" });
  const [vLines, setVLines] = useState<VariationLineForm[]>([blankVariationLine()]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await fn(); onSaved(message); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal memproses."); }
    finally { setBusy(false); }
  };

  const openCreate = () => {
    setEditing(null); setBudgetType("CLIENT"); setRevisionNote("");
    setLines([{ ...blankLine(), costCategoryId: data.categories[0]?.id ?? "" }]); setBudgetOpen(true); setError("");
  };
  const openEdit = (v: BudgetView) => {
    setEditing(v); setBudgetType(v.type as "CLIENT" | "INTERNAL"); setRevisionNote("");
    setLines(v.lines.map((l) => ({
      code: l.code ?? "", costCategoryId: l.costCategoryId, description: l.description,
      quantity: l.quantity, unitCode: l.unitCode, unitAmount: l.unitAmount,
      contingencyPct: l.contingencyPct ?? "0", wbsItemId: l.wbsItemId ?? "", keywords: l.keywords ?? "",
    }))); setBudgetOpen(true); setError("");
  };
  const saveBudget = () => run(async () => {
    const payload = {
      type: budgetType,
      revisionNote: revisionNote || null,
      lines: lines.map((l, i) => ({
        code: l.code || null, costCategoryId: l.costCategoryId, description: l.description,
        quantity: l.quantity, unitCode: l.unitCode, unitAmount: l.unitAmount,
        contingencyPct: l.contingencyPct || null, wbsItemId: l.wbsItemId || null,
        keywords: l.keywords || null, sortOrder: i,
      })),
    };
    if (editing) await api(`/api/budgets/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, revisionNote: revisionNote || "Revisi pos RAB" }) });
    else await api("/api/budgets", { method: "POST", body: JSON.stringify({ ...payload, projectId: project.id }) });
    setBudgetOpen(false);
  }, editing ? "Revisi RAB tersimpan (audit diff tercatat)." : "Versi RAB DRAFT dibuat.");

  const budgetAction = (id: string, action: string) => run(async () => {
    const reason = ["RETURN", "REJECT"].includes(action) ? window.prompt("Alasan (minimal 5 karakter):") ?? "" : undefined;
    await api(`/api/budgets/${id}/action`, { method: "POST", body: JSON.stringify({ action, reason }) });
  }, `RAB: ${action} berhasil.`);

  const openVariation = () => {
    setVType("ADD"); setVForm({ title: "", reason: "", scopeDescription: "", timeImpactDays: "0", clientReference: "" });
    setVLines([blankVariationLine()]); setVariationOpen(true); setError("");
  };
  const saveVariation = () => run(async () => {
    const price = vLines.reduce((s, l) => s.plus(l.priceAmount || 0), D(0));
    const cost = vLines.reduce((s, l) => s.plus(l.costAmount || 0), D(0));
    await api("/api/variations", { method: "POST", body: JSON.stringify({
      projectId: project.id, variationType: vType, ...vForm,
      timeImpactDays: Number(vForm.timeImpactDays),
      priceImpact: money(price), costImpact: money(cost),
      lines: vLines.map((l, i) => ({
        action: l.action, budgetType: l.budgetType, budgetLineId: l.budgetLineId || null,
        description: l.description, quantity: l.quantity, unitCode: l.unitCode,
        unitAmount: l.unitAmount, priceAmount: l.priceAmount, costAmount: l.costAmount, sortOrder: i,
      })),
    }) });
    setVariationOpen(false);
  }, "PTK dibuat sebagai DRAFT.");

  const variationAction = (id: string, action: string) => run(async () => {
    const reason = ["REJECT", "CANCEL"].includes(action) ? window.prompt("Alasan (minimal 5 karakter):") ?? "" : undefined;
    await api(`/api/variations/${id}/action`, { method: "POST", body: JSON.stringify({ action, reason }) });
  }, `PTK: ${action} berhasil.`);

  const baselineLineOptions = baselines.flatMap((b) => b.lines.map((l) => ({
    id: l.id, label: `${b.type} · ${l.code || l.description.slice(0, 28)}`, type: b.type,
  })));

  return <div className="space-y-6">
    {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger" role="alert">{error}</p> : null}

    <section>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-[15px] font-semibold tracking-[-.01em]">Versi RAB &amp; baseline</h2>
          <p className="mt-1 text-xs text-muted">DRAFT → REVIEW → APPROVED → BASELINE. Baseline terkunci dan hanya bisa digantikan revisi baru.</p></div>
        {canEdit ? <Button size="sm" onClick={openCreate}><Plus size={14} />Versi baru</Button> : null}
      </div>
      {!versions.length ? <EmptyState title="Belum ada RAB" description="Buat versi RAB klien atau internal untuk proyek ini." /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {versions.map((v) => <article key={v.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><Badge value={v.status} /><span className="text-[11px] font-semibold text-muted">v{v.versionNo} · {LABELS[v.type] || v.type}</span></div>
                <p className="mono mt-3 text-[15px] font-semibold tabular">{formatIDR(v.total)}</p>
                <p className="mt-1 text-[11px] text-muted">{v.lines.length} pos{v.isActiveBaseline ? " · baseline aktif" : ""}{v.lockedAt ? " · terkunci" : ""}</p>
                {v.revisionNote ? <p className="mt-1 text-[11px] text-muted">Catatan: {v.revisionNote}</p> : null}</div>
              {v.isActiveBaseline ? <Badge value="BASELINE" /> : null}
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-hairline pt-2.5">
              {v.status === "DRAFT" && canEdit ? <Button size="sm" variant="secondary" onClick={() => openEdit(v)}>Ubah pos</Button> : null}
              {v.status === "DRAFT" && canEdit ? <Button size="sm" variant="ghost" onClick={() => void budgetAction(v.id, "SUBMIT")}>Kirim review</Button> : null}
              {v.status === "REVIEW" && canApprove ? <><Button size="sm" variant="ghost" onClick={() => void budgetAction(v.id, "RETURN")}>Kembalikan</Button><Button size="sm" onClick={() => void budgetAction(v.id, "APPROVE")}>Setujui</Button></> : null}
              {v.status === "APPROVED" && canApprove ? <Button size="sm" variant="lime" onClick={() => void budgetAction(v.id, "SET_BASELINE")}>Jadikan baseline</Button> : null}
            </div>
          </article>)}
        </div>)}
    </section>

    {baselines.length ? <section>
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-.01em]">Pagu per pos (baseline aktif)</h2>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[720px] text-xs"><thead className="bg-sunken text-muted"><tr>
          <th className="px-3 py-2 text-left font-semibold">Pos</th><th className="px-3 py-2 text-right font-semibold">Pagu</th>
          <th className="px-3 py-2 text-right font-semibold">Aktual</th><th className="px-3 py-2 text-right font-semibold">Pending</th>
          <th className="px-3 py-2 text-right font-semibold">Komitmen PO</th><th className="px-3 py-2 text-right font-semibold">Terpakai</th>
        </tr></thead><tbody>
          {baselines.flatMap((b) => b.lines.filter((l) => l.lineStatus !== "OMITTED").map((l) => {
            const ev = evaluatePagu({
              total: l.total, contingencyPct: l.contingencyPct,
              actual: l.actualAmount, pending: l.pendingAmount, committed: l.committedAmount,
            });
            return <tr key={l.id} className="border-t border-hairline">
              <td className="px-3 py-2"><span className="font-semibold">{l.code} {l.description}</span><span className="ml-1 text-muted">({b.type})</span></td>
              <td className="mono px-3 py-2 text-right tabular">{formatIDR(ev.pagu, true)}</td>
              <td className="mono px-3 py-2 text-right tabular">{formatIDR(l.actualAmount, true)}</td>
              <td className="mono px-3 py-2 text-right tabular">{formatIDR(l.pendingAmount, true)}</td>
              <td className="mono px-3 py-2 text-right tabular">{formatIDR(l.committedAmount, true)}</td>
              <td className={`mono px-3 py-2 text-right font-semibold tabular ${ev.tone === "danger" ? "text-danger" : ev.tone === "warn" ? "text-risk" : ""}`}>{Number.isFinite(ev.ratioPct) ? ev.ratioPct.toFixed(0) : "∞"}%</td>
            </tr>;
          }))}
        </tbody></table>
      </div>
      <p className="mt-2 text-[11px] text-muted">Pagu = nilai pos + kontingensi. &gt;90% peringatan, &gt;100% diblokir kecuali ada alasan + izin <code>budget.approve</code>.</p>
    </section> : null}

    <section>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-[15px] font-semibold tracking-[-.01em]">Pekerjaan Tambah / Kurang (PTK)</h2>
          <p className="mt-1 text-xs text-muted">Dampak harga, biaya, dan waktu bertanda. Implementasi membuat revisi baseline + satu nilai kontrak berjalan.</p></div>
        {canVariation ? <Button size="sm" onClick={openVariation}><Plus size={14} />Buat PTK</Button> : null}
      </div>
      {!variations.length ? <EmptyState title="Belum ada PTK" description="Catat pekerjaan tambah, kurang, atau substitusi beserta bukti persetujuan klien." /> : (
        <div className="space-y-3">{variations.map((v: VariationOrderView) => <article key={v.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><Badge value={v.status} /><Badge value={v.variationType} /><span className="text-[11px] font-semibold text-muted">{v.code}</span></div>
              <h3 className="mt-3 text-sm font-semibold">{v.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{v.scopeDescription}</p>
              <p className="mt-1 text-[11px] text-muted">Alasan: {v.reason}{v.clientReference ? ` · Ref klien: ${v.clientReference}` : ""}</p></div>
            <div className="grid shrink-0 grid-cols-3 gap-4 text-right">
              <div><p className="text-[11px] text-muted">Harga</p><p className="mono mt-0.5 text-[12.5px] font-semibold tabular">{formatIDR(v.priceImpact, true)}</p></div>
              {canInternal ? <div><p className="text-[11px] text-muted">Biaya</p><p className="mono mt-0.5 text-[12.5px] font-semibold tabular">{formatIDR(v.costImpact, true)}</p></div> : <div />}
              <div><p className="text-[11px] text-muted">Waktu</p><p className="mt-1 text-sm font-semibold">{v.timeImpactDays >= 0 ? "+" : ""}{v.timeImpactDays} hari</p></div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-hairline pt-2.5">
            {v.status === "DRAFT" && canVariation ? <Button size="sm" variant="secondary" onClick={() => void variationAction(v.id, "SUBMIT")}>Kirim review</Button> : null}
            {v.status === "INTERNAL_REVIEW" && canVariation ? <Button size="sm" variant="ghost" onClick={() => void variationAction(v.id, "SEND_CLIENT")}>Kirim ke klien</Button> : null}
            {["INTERNAL_REVIEW", "AWAITING_CLIENT"].includes(v.status) && canVariationApprove ? <Button size="sm" onClick={() => void variationAction(v.id, "APPROVE")}>Catat persetujuan klien</Button> : null}
            {v.status === "APPROVED" && canVariationApprove ? <Button size="sm" variant="lime" onClick={() => void variationAction(v.id, "IMPLEMENT")}>Implementasikan</Button> : null}
            {["DRAFT", "INTERNAL_REVIEW", "AWAITING_CLIENT", "APPROVED"].includes(v.status) && canVariationApprove ? <Button size="sm" variant="ghost" onClick={() => void variationAction(v.id, "CANCEL")}>Batalkan</Button> : null}
          </div>
        </article>)}</div>)}
    </section>

    <Modal open={budgetOpen} onClose={() => setBudgetOpen(false)} wide title={editing ? `Revisi RAB v${editing.versionNo}` : "Versi RAB baru"} eyebrow={project.code}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis"><Select value={budgetType} disabled={!!editing} onChange={(e) => setBudgetType(e.target.value as "CLIENT" | "INTERNAL")}>
          <option value="CLIENT">RAB Klien</option><option value="INTERNAL">Anggaran Internal</option></Select></Field>
        <Field label="Catatan revisi" hint="Wajib saat mengubah versi DRAFT"><Input value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} placeholder="Mis. revisi volume setelah survey" /></Field>
      </div>
      <div className="mt-4 space-y-2">{lines.map((l, i) => <div key={i} className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
        <div className="grid gap-2 sm:grid-cols-6">
          <Field label="Kode" className="sm:col-span-1"><Input value={l.code} onChange={(e) => setLines(setAt(lines, i, { code: e.target.value }))} /></Field>
          <Field label="Kategori" className="sm:col-span-2"><Select value={l.costCategoryId} onChange={(e) => setLines(setAt(lines, i, { costCategoryId: e.target.value }))}>
            <option value="">Pilih…</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></Field>
          <Field label="Uraian" className="sm:col-span-3"><Input value={l.description} onChange={(e) => setLines(setAt(lines, i, { description: e.target.value }))} /></Field>
          <Field label="Volume"><Input inputMode="decimal" value={l.quantity} onChange={(e) => setLines(setAt(lines, i, { quantity: e.target.value }))} /></Field>
          <Field label="Satuan"><Input value={l.unitCode} onChange={(e) => setLines(setAt(lines, i, { unitCode: e.target.value }))} /></Field>
          <Field label="Harga satuan"><Input inputMode="decimal" value={l.unitAmount} onChange={(e) => setLines(setAt(lines, i, { unitAmount: e.target.value }))} /></Field>
          <Field label="Kontingensi %"><Input inputMode="decimal" value={l.contingencyPct} onChange={(e) => setLines(setAt(lines, i, { contingencyPct: e.target.value }))} /></Field>
          <Field label="WBS (opsional)"><Select value={l.wbsItemId} onChange={(e) => setLines(setAt(lines, i, { wbsItemId: e.target.value }))}>
            <option value="">—</option>{data.schedule.filter((s) => s.projectId === project.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Keyword harga (opsional)"><Input value={l.keywords} onChange={(e) => setLines(setAt(lines, i, { keywords: e.target.value }))} /></Field>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
          <span className="mono">Total {formatIDR(lineTotal(l.quantity || "0", l.unitAmount || "0"))}</span>
          <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-danger disabled:opacity-40" disabled={lines.length === 1} aria-label="Hapus pos"><Trash2 size={13} />Hapus</button>
        </div>
      </div>)}</div>
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setLines([...lines, blankLine()])}><Plus size={13} />Tambah pos</Button>
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      <Button className="mt-4 w-full" loading={busy} onClick={() => void saveBudget()}>{editing ? "Simpan revisi" : "Simpan DRAFT"}</Button>
    </Modal>

    <Modal open={variationOpen} onClose={() => setVariationOpen(false)} wide title="Buat PTK" eyebrow={project.code}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis perubahan"><Select value={vType} onChange={(e) => setVType(e.target.value as "ADD" | "OMIT" | "SUBSTITUTE")}>
          <option value="ADD">Pekerjaan Tambah</option><option value="OMIT">Pekerjaan Kurang</option><option value="SUBSTITUTE">Substitusi</option></Select></Field>
        <Field label="Dampak waktu (hari, boleh negatif)"><Input type="number" value={vForm.timeImpactDays} onChange={(e) => setVForm({ ...vForm, timeImpactDays: e.target.value })} /></Field>
        <Field label="Judul" className="sm:col-span-2"><Input value={vForm.title} onChange={(e) => setVForm({ ...vForm, title: e.target.value })} /></Field>
        <Field label="Lingkup" className="sm:col-span-2"><Textarea value={vForm.scopeDescription} onChange={(e) => setVForm({ ...vForm, scopeDescription: e.target.value })} /></Field>
        <Field label="Alasan" className="sm:col-span-2"><Textarea value={vForm.reason} onChange={(e) => setVForm({ ...vForm, reason: e.target.value })} /></Field>
        <Field label="Referensi persetujuan klien" className="sm:col-span-2"><Input value={vForm.clientReference} onChange={(e) => setVForm({ ...vForm, clientReference: e.target.value })} placeholder="No. BA / addendum" /></Field>
      </div>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-[.08em] text-muted">Pos terdampak</h3>
      <div className="mt-2 space-y-2">{vLines.map((l, i) => <div key={i} className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Aksi"><Select value={l.action} onChange={(e) => setVLines(setAt(vLines, i, { action: e.target.value as VariationLineForm["action"] }))}>
            <option value="ADD">Tambah pos</option><option value="OMIT">Coret pos</option><option value="ADJUST">Ubah volume/harga</option></Select></Field>
          <Field label="RAB"><Select value={l.budgetType} onChange={(e) => setVLines(setAt(vLines, i, { budgetType: e.target.value as "CLIENT" | "INTERNAL" }))}>
            <option value="CLIENT">RAB Klien</option><option value="INTERNAL">Internal</option></Select></Field>
          <Field label="Pos existing" className="sm:col-span-2"><Select value={l.budgetLineId} disabled={l.action === "ADD"} onChange={(e) => setVLines(setAt(vLines, i, { budgetLineId: e.target.value }))}>
            <option value="">— pilih pos baseline —</option>{baselineLineOptions.filter((o) => o.type === l.budgetType).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label="Uraian" className="sm:col-span-4"><Input value={l.description} onChange={(e) => setVLines(setAt(vLines, i, { description: e.target.value }))} /></Field>
          <Field label="Volume"><Input inputMode="decimal" value={l.quantity} onChange={(e) => setVLines(setAt(vLines, i, { quantity: e.target.value }))} /></Field>
          <Field label="Satuan"><Input value={l.unitCode} onChange={(e) => setVLines(setAt(vLines, i, { unitCode: e.target.value }))} /></Field>
          <Field label="Harga satuan"><Input inputMode="decimal" value={l.unitAmount} onChange={(e) => setVLines(setAt(vLines, i, { unitAmount: e.target.value }))} /></Field>
          <Field label="Dampak harga (boleh −)"><Input inputMode="decimal" value={l.priceAmount} onChange={(e) => setVLines(setAt(vLines, i, { priceAmount: e.target.value }))} /></Field>
          <Field label="Dampak biaya (boleh −)"><Input inputMode="decimal" value={l.costAmount} onChange={(e) => setVLines(setAt(vLines, i, { costAmount: e.target.value }))} /></Field>
        </div>
        <div className="mt-2 flex justify-end"><button type="button" onClick={() => setVLines(vLines.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-[11px] text-danger disabled:opacity-40" disabled={vLines.length === 1}><Trash2 size={13} />Hapus pos</button></div>
      </div>)}</div>
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setVLines([...vLines, blankVariationLine()])}><Plus size={13} />Tambah pos</Button>
      <p className="mt-3 text-[11px] text-muted">Total dampak harga <span className="mono font-semibold">{formatIDR(money(vLines.reduce((s, l) => s.plus(l.priceAmount || 0), D(0))))}</span> · biaya <span className="mono font-semibold">{formatIDR(money(vLines.reduce((s, l) => s.plus(l.costAmount || 0), D(0))))}</span> (dihitung otomatis dari pos).</p>
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      <Button className="mt-4 w-full" loading={busy} onClick={() => void saveVariation()}>Simpan PTK DRAFT</Button>
    </Modal>
  </div>;
}

function setAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}
