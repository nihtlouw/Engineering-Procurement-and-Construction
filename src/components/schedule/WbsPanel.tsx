"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, GitBranch, Save, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Field, Input, Modal } from "@/components/ui";
import { fetchSCurve, fetchWbs, lockWbsCalendar, saveWbsRecord, type SCurveView, type WbsCalendarView } from "@/lib/client";
import type { AppData, ProjectView } from "@/components/types";
import { formatDate } from "@/lib/format";
import SCurveChart, { SCurveTable } from "@/components/schedule/SCurveChart";
import WbsEditor, { activityWeight, toDraft, toPayload, weightedProgress, type DraftItem } from "@/components/schedule/WbsEditor";

/* Audit S5 (#10): jadwal sebelumnya hanya daftar + update progres. Panel ini
 * menambah CRUD WBS (hierarki, bobot Σ100%), kalender WBS terkunci, dan kurva-S
 * rencana vs aktual per minggu. */

export default function WbsPanel({ data, project, onSaved }: {
  data: AppData; project: ProjectView; onSaved: (message: string) => void;
}) {
  const canEdit = data.user.permissions.includes("schedule.edit");
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [calendars, setCalendars] = useState<WbsCalendarView[]>([]);
  const [curve, setCurve] = useState<SCurveView | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [note, setNote] = useState("");
  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");

  const load = useCallback(() => Promise.all([fetchWbs(project.id), fetchSCurve(project.id)])
    .then(([wbs, scurve]) => {
      setItems(toDraft(wbs.items));
      setCalendars(wbs.calendars);
      setCurve(scurve);
      setDirty(false);
      setError("");
    })
    .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat WBS.")), [project.id]);
  useEffect(() => { void load(); }, [load]);

  // `users` di workspace sudah terproyeksi per izin (directory terbatas).
  const owners = useMemo(
    () => (data.users ?? []).map((user) => ({ id: user.id, name: user.name })),
    [data.users],
  );
  const latestCalendar = calendars[0] ?? null;
  const locked = latestCalendar?.status === "LOCKED";

  if (!items) {
    return error
      ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p>
      : <p className="text-xs text-muted">Memuat WBS & kurva-S…</p>;
  }

  const total = activityWeight(items);
  const progress = weightedProgress(items);

  const save = async (allowIncomplete = false) => {
    setSaving(true); setError("");
    try {
      await saveWbsRecord(project.id, {
        items: toPayload(items).filter((item) => item.name.trim().length >= 3),
        startDate: curve?.startDate,
        endDate: curve?.endDate,
        allowIncomplete,
        note: note.trim() || null,
      });
      onSaved(`WBS ${project.code} tersimpan (${items.length} item, Σ bobot ${total.toFixed(2)}%).`);
      setNote("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan WBS."); } finally { setSaving(false); }
  };

  const lock = async () => {
    setSaving(true); setError("");
    try {
      await lockWbsCalendar(project.id, lockReason);
      onSaved(`Kalender WBS v${latestCalendar?.version ?? 1} dikunci.`);
      setLockOpen(false); setLockReason("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengunci kalender WBS."); } finally { setSaving(false); }
  };

  const deviation = curve?.deviation ?? 0;
  const VerdictIcon = curve?.status === "BEHIND" ? TrendingDown : TrendingUp;
  const verdictLabel = curve?.status === "AHEAD" ? "Lebih cepat" : curve?.status === "BEHIND" ? "Terlambat" : curve?.status === "ON_TRACK" ? "Sesuai rencana" : "Belum ada aktual";

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}
      {!canEdit ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Peran Anda hanya dapat melihat WBS. Izin <code>schedule.edit</code> diperlukan untuk mengubah.</p> : null}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold"><GitBranch size={15} />Struktur WBS</h2>
          <div className="flex flex-wrap items-center gap-2">
            {latestCalendar ? <span className="text-[11px] text-muted">Kalender v{latestCalendar.version} · <Badge value={latestCalendar.status} /></span> : null}
            {canEdit && !locked ? <>
              <Button size="sm" variant="ghost" onClick={() => setLockOpen(true)}>Kunci kalender</Button>
              <Button size="sm" variant="secondary" loading={saving} disabled={!dirty && !note} onClick={() => void save(Math.abs(total - 100) > 0.01)}>
                <Save size={14} />Simpan WBS
              </Button>
            </> : null}
          </div>
        </div>
        <WbsEditor
          items={items}
          owners={owners}
          canEdit={canEdit}
          locked={locked}
          onChange={(next) => { setItems(next); setDirty(true); }}
        />
        {canEdit && !locked ? <Field label="Catatan revisi WBS (opsional)" className="mt-3 max-w-xl">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. menambah pekerjaan pondasi trafo" />
        </Field> : null}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold"><Activity size={15} />Kurva-S rencana vs aktual</h2>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge value={curve?.status ?? "NO_DATA"} tone={curve?.status === "BEHIND" ? "danger" : curve?.status === "AHEAD" ? "ok" : "neutral"} />
            <span className={`inline-flex items-center gap-1 font-semibold ${deviation < -0.5 ? "text-danger" : deviation > 0.5 ? "text-ok" : "text-muted"}`}>
              <VerdictIcon size={13} />{verdictLabel} {deviation !== 0 ? `(${deviation > 0 ? "+" : ""}${deviation.toFixed(2)} poin)` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setShowTable((old) => !old)}>{showTable ? "Sembunyikan tabel" : "Lihat tabel"}</Button>
          </div>
        </div>
        <div className="band mb-3 grid gap-3 p-3 sm:grid-cols-4">
          <div><p className="band-k">Rencana s/d akhir</p><p className="band-v">{curve ? `${curve.plannedTotal.toFixed(2)}%` : "—"}</p><p className="band-f">{curve ? `${formatDate(curve.startDate)} → ${formatDate(curve.endDate)}` : ""}</p></div>
          <div><p className="band-k">Aktual kumulatif</p><p className="band-v">{curve && curve.status !== "NO_DATA" ? `${curve.actualTotal.toFixed(2)}%` : "—"}</p><p className="band-f">dari update lapangan</p></div>
          <div><p className="band-k">Progres terbobot</p><p className="band-v">{progress.toFixed(2)}%</p><p className="band-f">{items.filter((item) => !item.isSummary).length} aktivitas</p></div>
          <div><p className="band-k">Σ bobot</p><p className={`band-v ${Math.abs(total - 100) > 0.01 ? "text-danger" : ""}`}>{total.toFixed(2)}%</p><p className="band-f">{locked ? "kalender terkunci" : "draft"}</p></div>
        </div>
        {curve?.warning ? <p className="mb-3 rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">{curve.warning}</p> : null}
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
          <SCurveChart periods={curve?.periods ?? []} />
        </div>
        {showTable ? <div className="mt-3"><SCurveTable periods={curve?.periods ?? []} /></div> : null}
      </section>

      {latestCalendar ? <section className="rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
        <h3 className="mb-2 text-[12px] font-semibold">Riwayat kalender WBS</h3>
        <ul className="space-y-1.5">
          {calendars.map((calendar) => (
            <li key={calendar.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
              <span>v{calendar.version} · {calendar.itemCount} aktivitas · Σ {Number(calendar.totalWeight).toFixed(2)}% · progres {Number(calendar.weightedProgress).toFixed(2)}%</span>
              <span className="flex items-center gap-2">
                <Badge value={calendar.status} />
                <span className="mono">{calendar.lockedAt ? formatDate(calendar.lockedAt) : formatDate(calendar.updatedAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section> : null}

      <Modal open={lockOpen} onClose={() => setLockOpen(false)} title="Kunci kalender WBS" eyebrow="Baseline bobot & tanggal">
        <p className="mb-4 text-xs leading-relaxed text-muted">Setelah dikunci, struktur WBS tidak dapat diubah peran non-ADMIN. Bobot harus tepat 100% dan semua tanggal rencana terisi.</p>
        <Field label="Alasan penguncian (wajib)"><Input value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="minimal 5 karakter, mis. baseline disetujui direksi" /></Field>
        {Math.abs(total - 100) > 0.01 ? <p className="mt-3 rounded-[var(--radius-control)] bg-warn-bg p-2.5 text-[11px] text-warn">Σ bobot aktivitas {total.toFixed(2)}% — server menolak penguncian sebelum 100%.</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLockOpen(false)}>Batal</Button>
          <Button loading={saving} disabled={lockReason.trim().length < 5} onClick={() => void lock()}>Kunci kalender</Button>
        </div>
      </Modal>
    </div>
  );
}
