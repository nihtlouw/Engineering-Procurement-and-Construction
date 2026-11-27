"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Lock, Plus, Trash2, Wallet } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { closeContractTerm, fetchContractTerms, saveContractTerms, type ContractTermView } from "@/lib/client";
import { LABELS } from "@/lib/domain";
import { formatDate, formatIDR } from "@/lib/format";
import type { ProjectView } from "@/components/types";

/* Audit DOM-01 (tahap 3): termin kontrak sebelumnya hanya bisa dibuat lewat
 * `scripts/seed-demo.ts`. Tab ini menyimpan daftar termin sebagai satu kesatuan
 * (replace-by-set) karena komposisi persen harus divalidasi atomik di server. */

const TERM_TYPES = ["DP", "MOS", "PROGRESS", "FINAL", "RETENTION", "OTHER"] as const;

type Draft = {
  id: string | null; type: string; name: string; percent: string; amount: string;
  trigger: string; targetDate: string; notes: string;
  invoicedAmount: string; invoiceCount: number; status: string;
};

const toDraft = (term: ContractTermView): Draft => ({
  id: term.id, type: term.type, name: term.name,
  percent: term.percent ? String(Number(term.percent)) : "",
  amount: term.percent ? "" : String(Number(term.amount ?? 0)),
  trigger: term.trigger ?? "", targetDate: term.targetDate ?? "", notes: term.notes ?? "",
  invoicedAmount: term.invoicedAmount, invoiceCount: term.invoiceCount, status: term.status,
});

const blank = (index: number): Draft => ({
  id: null, type: index === 0 ? "DP" : "PROGRESS", name: "", percent: "", amount: "",
  trigger: "", targetDate: "", notes: "", invoicedAmount: "0", invoiceCount: 0, status: "OPEN",
});

export default function TermsTab({ projects, canEdit, onSaved }: {
  projects: ProjectView[]; canEdit: boolean; onSaved: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  // `null` = belum termuat; menghindari setState sinkron di dalam effect (React Compiler).
  const [terms, setTerms] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => fetchContractTerms(projectId)
    .then((rows) => { setTerms(rows.map(toDraft)); setError(""); })
    .catch((e) => { setError(e instanceof Error ? e.message : "Gagal memuat termin."); setTerms([]); }), [projectId]);

  useEffect(() => { if (projectId) void load(); }, [load, projectId]);

  const project = projects.find((p) => p.id === projectId);
  if (!projects.length) {
    return <EmptyState icon={<Wallet size={18} />} title="Belum ada proyek" description="Termin kontrak menempel pada proyek. Buat proyek terlebih dahulu." />;
  }
  const rows = terms ?? [];

  const totalPercent = rows.reduce((sum, t) => sum + (t.percent.trim() === "" ? 0 : Number(t.percent) || 0), 0);
  const percentCount = rows.filter((t) => t.percent.trim() !== "").length;
  const mixed = percentCount > 0 && percentCount !== rows.length;
  const compositionOk = percentCount === 0 || Math.abs(totalPercent - 100) <= 0.01;

  const set = (index: number, patch: Partial<Draft>) =>
    setTerms((list) => (list ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload = rows.map((term) => ({
        id: term.id,
        type: term.type,
        name: term.name.trim(),
        percent: term.percent.trim() === "" ? null : term.percent.trim(),
        amount: term.percent.trim() === "" ? (term.amount.trim() || null) : null,
        trigger: term.trigger.trim() || null,
        targetDate: term.targetDate || null,
        notes: term.notes.trim() || null,
      }));
      const result = await saveContractTerms(projectId, payload);
      onSaved(`Termin ${project?.code ?? ""}: ${result.count} baris tersimpan (total ${result.totalPercent.toFixed(2)}%).`);
      void load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan termin."); } finally { setSaving(false); }
  };

  const close = async (term: Draft) => {
    const reason = window.prompt(`Alasan menutup termin "${term.name}"? (min. 5 karakter)`);
    if (!reason) return;
    try {
      await closeContractTerm(projectId, term.id!, reason);
      onSaved(`Termin ${term.name} ditutup.`);
      void load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menutup termin."); }
  };

  const invoicedTotal = rows.reduce((sum, t) => sum + Number(t.invoicedAmount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Proyek" className="min-w-[240px] flex-1 sm:max-w-md">
          <Select value={projectId} onChange={(e) => { setTerms(null); setProjectId(e.target.value); }}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}
          </Select>
        </Field>
        {canEdit ? <Button size="sm" variant="secondary" disabled={!terms} onClick={() => setTerms((list) => [...(list ?? []), blank(list?.length ?? 0)])}><Plus size={14} />Termin</Button> : null}
      </div>

      <div className="band grid gap-3 p-3 sm:grid-cols-3">
        <div><p className="band-k">Nilai kontrak berjalan</p><p className="band-v">{formatIDR(project?.contractValueCurrent, true)}</p></div>
        <div><p className="band-k">Total persen</p><p className={`band-v ${compositionOk ? "" : "text-danger"}`}>{totalPercent.toFixed(2)}%</p><p className="band-f">{percentCount === 0 ? "semua nominal manual" : mixed ? "campuran persen & nominal" : "mode persen"}</p></div>
        <div><p className="band-k">Sudah ditagihkan</p><p className="band-v">{formatIDR(invoicedTotal, true)}</p><p className="band-f">{rows.length} termin</p></div>
      </div>

      {!compositionOk ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Total persen {totalPercent.toFixed(2)}% — komposisi termin persen harus tepat 100% sebelum disimpan.</p> : null}
      {!canEdit ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Peran Anda hanya dapat melihat termin. Izin <code>invoice.edit</code> diperlukan untuk mengubah.</p> : null}
      {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}

      {!terms ? <p className="text-xs text-muted">Memuat termin…</p> : null}
      {terms && !rows.length ? <EmptyState icon={<Wallet size={18} />} title="Belum ada termin" description="Termin menentukan pagu penarikan invoice klien. Tambahkan baris atau pakai skema standar." action={canEdit ? <Button size="sm" variant="secondary" onClick={() => setTerms([blank(0)])}><Plus size={14} />Termin pertama</Button> : undefined} /> : null}

      <div className="space-y-2.5">
        {rows.map((term, index) => {
          const locked = term.invoiceCount > 0;
          const percentMode = term.percent.trim() !== "";
          const amountPreview = percentMode && project?.contractValueCurrent
            ? formatIDR(Number(project.contractValueCurrent) * (Number(term.percent) || 0) / 100, true)
            : null;
          return (
            <article key={term.id ?? `new-${index}`} className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="mono rounded bg-paper-2 px-1.5 py-0.5 text-[11px] font-semibold">#{index + 1}</span>
                  <Badge value={term.status} />
                  {locked ? <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Lock size={11} />{term.invoiceCount} tagihan</span> : null}
                </div>
                {canEdit ? <div className="flex gap-1">
                  {locked && term.id && term.status !== "CLOSED" ? <Button size="sm" variant="ghost" onClick={() => void close(term)}>Tutup</Button> : null}
                  {locked
                    ? null
                    : <Button size="sm" variant="ghost" className="text-danger" onClick={() => setTerms((list) => (list ?? []).filter((_, i) => i !== index))}><Trash2 size={13} />Hapus</Button>}
                </div> : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Jenis"><Select disabled={!canEdit} value={term.type} onChange={(e) => set(index, { type: e.target.value })}>{TERM_TYPES.map((t) => <option key={t} value={t}>{LABELS[t] ?? t}</option>)}</Select></Field>
                <Field label="Nama termin"><Input disabled={!canEdit} value={term.name} onChange={(e) => set(index, { name: e.target.value })} placeholder="mis. Uang muka 30%" /></Field>
                <Field label="Persen (%)" hint={amountPreview ? `≈ ${amountPreview} dari nilai berjalan` : "Kosongkan bila memakai nominal manual."}>
                  <Input disabled={!canEdit} inputMode="decimal" value={term.percent} onChange={(e) => set(index, { percent: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Nominal manual (IDR)" hint={percentMode ? "Diabaikan saat persen diisi." : "Wajib bila persen kosong."}>
                  <Input disabled={!canEdit || percentMode} inputMode="decimal" value={term.amount} onChange={(e) => set(index, { amount: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Pemicu"><Input disabled={!canEdit} value={term.trigger} onChange={(e) => set(index, { trigger: e.target.value })} placeholder="mis. BA uang muka ditandatangani" /></Field>
                <Field label="Target tanggal"><Input disabled={!canEdit} type="date" value={term.targetDate} onChange={(e) => set(index, { targetDate: e.target.value })} /></Field>
                <Field label="Catatan" className="sm:col-span-2"><Textarea disabled={!canEdit} className="min-h-16" value={term.notes} onChange={(e) => set(index, { notes: e.target.value })} placeholder="Opsional: syarat dokumen, penagihan, dsb." /></Field>
              </div>

              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1"><CalendarClock size={11} />{term.targetDate ? formatDate(term.targetDate) : "tanpa target"}</span>
                <span>Pagu: <strong className="text-ink">{percentMode ? amountPreview ?? "—" : formatIDR(term.amount || 0, true)}</strong></span>
                <span>Ditagih: <strong className="text-ink">{formatIDR(term.invoicedAmount, true)}</strong></span>
              </p>
            </article>
          );
        })}
      </div>

      {canEdit && terms ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-[11px] text-muted">Termin yang sudah memiliki tagihan tidak dapat dihapus; gunakan <strong>Tutup</strong> dengan alasan.</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTerms([
            { ...blank(0), type: "DP", name: "Uang muka", percent: "30" },
            { ...blank(1), type: "MOS", name: "Material on site", percent: "20" },
            { ...blank(2), type: "PROGRESS", name: "Progres pekerjaan", percent: "40" },
            { ...blank(3), type: "RETENTION", name: "Retensi", percent: "10" },
          ])}>Skema standar 30/20/40/10</Button>
          <Button variant="lime" loading={saving} disabled={!compositionOk} onClick={() => void save()}>Simpan termin</Button>
        </div>
      </div> : null}
    </div>
  );
}
