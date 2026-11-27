"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, ListTree, Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, Select } from "@/components/ui";
import type { WbsItemPayload, WbsItemView } from "@/lib/client";

/* Audit S5 (#10): WBS sebelumnya tidak punya CRUD — item hanya dari seed.
 * Editor ini menyimpan daftar sebagai satu kesatuan (replace-by-set) karena
 * Σ bobot aktivitas harus divalidasi atomik di server (100% ± 0,01). */

export const WBS_TYPES = ["SUMMARY", "WORK_PACKAGE", "ACTIVITY", "MILESTONE"] as const;
const MAX_LEVEL = 4;

export type DraftItem = {
  key: string; id: string | null; parentId: string | null; level: number; type: string;
  name: string; weight: string; progressPct: string; plannedStart: string; plannedEnd: string;
  ownerId: string; isSummary: boolean; code: string | null;
};

const key = () => globalThis.crypto?.randomUUID?.() ?? `tmp-${Math.random().toString(36).slice(2)}`;

export function toDraft(items: WbsItemView[]): DraftItem[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      key: item.id, id: item.id, parentId: item.parentId, level: item.level, type: item.type,
      name: item.name, weight: item.isSummary ? "0" : item.weight, progressPct: item.progressPct,
      plannedStart: item.plannedStart ?? "", plannedEnd: item.plannedEnd ?? "",
      ownerId: item.ownerId ?? "", isSummary: item.isSummary, code: item.code,
    }));
}

export function toPayload(items: DraftItem[]): WbsItemPayload[] {
  return items.map((item) => ({
    id: item.id, parentId: item.parentId, type: item.type, name: item.name.trim(),
    code: item.code, level: item.level, weight: item.isSummary ? "0" : item.weight,
    progressPct: item.progressPct, plannedStart: item.plannedStart || null,
    plannedEnd: item.plannedEnd || null, ownerId: item.ownerId || null,
    isSummary: item.isSummary,
  }));
}

/** Bobot aktivitas: item ringkasan tidak dihitung (bobot agregat anak). */
export function activityWeight(items: DraftItem[]) {
  return Math.round(items.filter((item) => !item.isSummary)
    .reduce((sum, item) => sum + (Number(item.weight) || 0), 0) * 100) / 100;
}

export function weightedProgress(items: DraftItem[]) {
  const activities = items.filter((item) => !item.isSummary);
  const weight = activities.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (!weight) return 0;
  const total = activities.reduce((sum, item) => sum + (Number(item.weight) || 0) * (Number(item.progressPct) || 0), 0);
  return Math.round((total / weight) * 100) / 100;
}

export default function WbsEditor({ items, onChange, owners, canEdit, locked }: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  owners: { id: string; name: string }[];
  canEdit: boolean;
  locked: boolean;
}) {
  const [error, setError] = useState("");
  const editable = canEdit && !locked;
  const total = activityWeight(items);
  const weightOk = Math.abs(total - 100) <= 0.01;
  const progress = weightedProgress(items);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, DraftItem[]>();
    for (const item of items) {
      const list = map.get(item.parentId) ?? [];
      list.push(item);
      map.set(item.parentId, list);
    }
    return map;
  }, [items]);

  const patch = (index: number, values: Partial<DraftItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...values } : item)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const addItem = (parentKey: string | null) => {
    const parent = parentKey ? items.find((item) => item.key === parentKey) : null;
    const level = parent ? Math.min(MAX_LEVEL, (parent.level ?? 1) + 1) : 1;
    const created: DraftItem = {
      key: key(), id: null, parentId: parent?.key ?? null, level,
      type: level === 1 ? "WORK_PACKAGE" : "ACTIVITY", name: "",
      weight: "0", progressPct: "0", plannedStart: "", plannedEnd: "",
      ownerId: "", isSummary: level === 1 && !parent, code: null,
    };
    // Anak ditempatkan tepat setelah induk agar tampilan pohon tetap urut.
    const parentIndex = parent ? items.findIndex((item) => item.key === parent.key) : -1;
    const next = [...items];
    next.splice(parentIndex + 1, 0, created);
    onChange(next);
  };
  const indent = (index: number, direction: 1 | -1) => {
    const item = items[index];
    const previous = items[index - 1];
    if (direction === -1) {
      // Naik satu level: lepas dari induk, geser setelah induk lama.
      if (!item.parentId) return;
      patch(index, { parentId: null, level: 1, isSummary: false });
      return;
    }
    if (!previous) { setError("Butuh item di atasnya untuk dijadikan induk."); return; }
    if (previous.level >= MAX_LEVEL) { setError("Level maksimal 4."); return; }
    setError("");
    patch(index, { parentId: previous.key, level: Math.min(MAX_LEVEL, previous.level + 1), isSummary: false });
  };
  const remove = (index: number) => {
    const item = items[index];
    // Hapus juga seluruh turunan agar tidak ada anak yatim.
    const removed = new Set([item.key]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of items) {
        if (candidate.parentId && removed.has(candidate.parentId) && !removed.has(candidate.key)) {
          removed.add(candidate.key);
          changed = true;
        }
      }
    }
    onChange(items.filter((candidate) => !removed.has(candidate.key)));
  };
  const evenOut = () => {
    const activities = items.filter((item) => !item.isSummary);
    if (!activities.length) return;
    const base = Math.floor((10000 / activities.length)) / 100;
    const remainder = Math.round((100 - base * activities.length) * 100) / 100;
    let seen = 0;
    onChange(items.map((item) => {
      if (item.isSummary) return item;
      seen += 1;
      const weight = seen === activities.length ? Math.round((base + remainder) * 100) / 100 : base;
      return { ...item, weight: weight.toFixed(2) };
    }));
  };

  const depth = (item: DraftItem) => {
    // Level dihitung ulang dari rantai induk agar tampilan konsisten.
    let level = 1;
    let parent = item.parentId;
    let guard = 0;
    while (parent && guard < 8) {
      const found = items.find((candidate) => candidate.key === parent);
      if (!found) break;
      level += 1;
      parent = found.parentId;
      guard += 1;
    }
    return level;
  };

  return (
    <div className="space-y-3">
      <div className="band grid gap-3 p-3 sm:grid-cols-4">
        <div><p className="band-k">Item WBS</p><p className="band-v">{items.length}</p><p className="band-f">{items.filter((i) => i.isSummary).length} ringkasan · {items.filter((i) => !i.isSummary).length} aktivitas</p></div>
        <div><p className="band-k">Σ bobot aktivitas</p><p className={`band-v ${weightOk ? "" : "text-danger"}`}>{total.toFixed(2)}%</p><p className="band-f">{weightOk ? "siap dikunci" : "harus tepat 100%"}</p></div>
        <div><p className="band-k">Progres terbobot</p><p className="band-v">{progress.toFixed(2)}%</p><p className="band-f">dari progres per aktivitas</p></div>
        <div><p className="band-k">Status kalender</p><p className="band-v">{locked ? "TERKUNCI" : "DRAFT"}</p><p className="band-f">{locked ? "perubahan butuh ADMIN" : "bisa diubah"}</p></div>
      </div>

      {!weightOk ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Total bobot aktivitas {total.toFixed(2)}% — gunakan <strong>Ratakan bobot</strong> atau sesuaikan manual sampai 100%.</p> : null}
      {locked ? <p className="rounded-[var(--radius-control)] bg-paper p-3 text-xs text-muted">Kalender WBS sudah dikunci. Hubungi ADMIN untuk revisi struktur.</p> : null}
      {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}

      {!items.length ? <EmptyState icon={<ListTree size={18} />} title="WBS masih kosong" description="Tambahkan grup pekerjaan lalu aktivitas di bawahnya. Bobot aktivitas harus berjumlah 100% agar kurva-S dapat dihitung." action={editable ? <Button size="sm" onClick={() => addItem(null)}><Plus size={14} />Grup pertama</Button> : undefined} /> : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-paper-2 text-left">
                <th className="p-2 font-semibold">Kode / item</th>
                <th className="w-28 p-2 font-semibold">Jenis</th>
                <th className="w-20 p-2 text-right font-semibold">Bobot %</th>
                <th className="w-20 p-2 text-right font-semibold">Progres %</th>
                <th className="w-32 p-2 font-semibold">Mulai</th>
                <th className="w-32 p-2 font-semibold">Selesai</th>
                <th className="w-36 p-2 font-semibold">PIC</th>
                {editable ? <th className="w-32 p-2 font-semibold">Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const level = depth(item);
                return (
                  <tr key={item.key} className={`border-b border-hairline ${item.isSummary ? "bg-paper-2/60" : ""}`}>
                    <td className="p-2">
                      <div style={{ paddingLeft: `${(level - 1) * 16}px` }} className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {item.code ? <span className="mono rounded bg-paper px-1 py-0.5 text-[10px] text-muted">{item.code}</span> : null}
                          {item.isSummary ? <Badge value="RINGKASAN" tone="neutral" dot={false} /> : null}
                          {item.id ? null : <span className="text-[10px] text-warn">baru</span>}
                        </div>
                        {editable
                          ? <Input value={item.name} placeholder={item.isSummary ? "Nama grup pekerjaan" : "Nama aktivitas"} onChange={(e) => patch(index, { name: e.target.value })} className="mt-1 h-8 text-[11.5px]" />
                          : <p className="mt-1 truncate text-[11.5px] font-semibold">{item.name}</p>}
                      </div>
                    </td>
                    <td className="p-2">
                      <Select disabled={!editable} value={item.type} className="h-8 text-[11px]" onChange={(e) => {
                        const type = e.target.value;
                        patch(index, { type, isSummary: type === "SUMMARY", weight: type === "SUMMARY" ? "0" : item.weight });
                      }}>
                        {WBS_TYPES.map((type) => <option key={type} value={type}>{type === "WORK_PACKAGE" ? "Grup" : type === "SUMMARY" ? "Ringkasan" : type === "MILESTONE" ? "Milestone" : "Aktivitas"}</option>)}
                      </Select>
                    </td>
                    <td className="p-2">
                      <Input disabled={!editable || item.isSummary} inputMode="decimal" value={item.isSummary ? "0" : item.weight}
                        className="h-8 text-right text-[11px]" onChange={(e) => patch(index, { weight: e.target.value })} />
                    </td>
                    <td className="p-2">
                      <Input disabled={!editable} inputMode="decimal" value={item.progressPct} className="h-8 text-right text-[11px]"
                        onChange={(e) => patch(index, { progressPct: e.target.value })} />
                    </td>
                    <td className="p-2"><Input disabled={!editable} type="date" value={item.plannedStart} className="h-8 text-[11px]" onChange={(e) => patch(index, { plannedStart: e.target.value })} /></td>
                    <td className="p-2"><Input disabled={!editable} type="date" value={item.plannedEnd} className="h-8 text-[11px]" onChange={(e) => patch(index, { plannedEnd: e.target.value })} /></td>
                    <td className="p-2">
                      <Select disabled={!editable} value={item.ownerId} className="h-8 text-[11px]" onChange={(e) => patch(index, { ownerId: e.target.value })}>
                        <option value="">—</option>
                        {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                      </Select>
                    </td>
                    {editable ? <td className="p-2">
                      <div className="flex flex-wrap items-center gap-0.5">
                        <Button size="sm" variant="ghost" aria-label="Tambah anak" title="Tambah anak" onClick={() => addItem(item.key)}><Plus size={12} /></Button>
                        <Button size="sm" variant="ghost" aria-label="Indentasi" title="Jadikan anak item di atas" onClick={() => indent(index, 1)}><IndentIncrease size={12} /></Button>
                        <Button size="sm" variant="ghost" aria-label="Kurangi indentasi" title="Naik satu level" onClick={() => indent(index, -1)}><IndentDecrease size={12} /></Button>
                        <Button size="sm" variant="ghost" aria-label="Naik" onClick={() => move(index, -1)}><ArrowUp size={12} /></Button>
                        <Button size="sm" variant="ghost" aria-label="Turun" onClick={() => move(index, 1)}><ArrowDown size={12} /></Button>
                        <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus item" onClick={() => remove(index)}><Trash2 size={12} /></Button>
                      </div>
                    </td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable ? <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => addItem(null)}><Plus size={14} />Item level 1</Button>
        <Button size="sm" variant="ghost" onClick={evenOut} disabled={!items.filter((item) => !item.isSummary).length}>Ratakan bobot 100%</Button>
        <span className="text-[11px] text-muted">{items.filter((item) => !item.isSummary).length} aktivitas · {childrenOf.get(null)?.length ?? 0} baris level 1</span>
      </div> : null}
      {items.some((item) => item.isSummary) ? <p className="text-[11px] leading-relaxed text-muted">Item ringkasan/induk mengambil bobot dari anak-anaknya, jadi bobotnya 0 dan tidak dihitung dalam Σ 100%.</p> : null}
    </div>
  );
}
