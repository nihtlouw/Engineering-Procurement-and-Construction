"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Image as ImageIcon, Minus, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

/* Audit UI-04 (S4): editor blok visual menggantikan textarea JSON mentah.
 * Blok tetap disimpan sebagai JSON yang sama (`DocumentBlock`), jadi renderer
 * PDF/DOCX tidak berubah. */

export type EditableBlock = Record<string, unknown> & { type: string };
type Row = Record<string, string>;

const BLOCK_TYPES = [
  { id: "heading", label: "Judul" },
  { id: "paragraph", label: "Paragraf" },
  { id: "keyValue", label: "Daftar kunci–nilai" },
  { id: "table", label: "Tabel" },
  { id: "signature", label: "Tanda tangan" },
  { id: "spacer", label: "Jarak" },
  { id: "pageBreak", label: "Pindah halaman" },
  { id: "photoGallery", label: "Galeri foto" },
] as const;

const asRows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
const asText = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function newBlock(type: string): EditableBlock {
  switch (type) {
    case "heading": return { type, level: 1, text: "JUDUL BAGIAN" };
    case "keyValue": return { type, rows: [{ label: "Label", value: "Nilai" }] };
    case "table": return { type, columns: [{ key: "a", label: "Kolom A" }, { key: "b", label: "Kolom B" }], rows: [{ a: "", b: "" }] };
    case "signature": return { type, parties: [{ label: "Untuk Klien", name: "", title: "" }, { label: "Untuk Kontraktor", name: "", title: "" }] };
    case "spacer": return { type, height: 24 };
    case "pageBreak": return { type };
    case "photoGallery": return { type, heading: "LAMPIRAN FOTO LAPANGAN", photos: [] };
    default: return { type: "paragraph", text: "Teks paragraf baru." };
  }
}

export default function BlockEditor({ blocks, onChange }: {
  blocks: EditableBlock[];
  onChange: (blocks: EditableBlock[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<number | null>(null);

  const update = (index: number, patch: EditableBlock) =>
    onChange(blocks.map((block, i) => (i === index ? patch : block)));
  const move = (index: number, delta: number) => {
    const next = [...blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        const open = collapsed !== index;
        return (
          <article key={index} className="rounded-[var(--radius-control)] border border-line bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <button className="flex items-center gap-2 text-left" onClick={() => setCollapsed(open ? index : null)}>
                <span className="mono rounded bg-paper-2 px-1.5 py-0.5 text-[10.5px] font-semibold">{index + 1}</span>
                <span className="text-[11.5px] font-semibold">
                  {BLOCK_TYPES.find((t) => t.id === block.type)?.label ?? block.type}
                </span>
                {!open && asText(block.text || block.heading).slice(0, 48) ? (
                  <span className="truncate text-[11px] text-muted">· {asText(block.text || block.heading).slice(0, 48)}</span>
                ) : null}
              </button>
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" aria-label="Naikkan blok" onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
                <Button size="sm" variant="ghost" aria-label="Turunkan blok" onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
                <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus blok" onClick={() => remove(index)}><Trash2 size={13} /></Button>
              </div>
            </header>
            {open ? <div className="p-3">
              <BlockFields block={block} onChange={(patch) => update(index, patch)} />
            </div> : null}
          </article>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface p-2.5">
        <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted"><Plus size={12} />Tambah blok</span>
        {BLOCK_TYPES.map((type) => (
          <Button key={type.id} size="sm" variant="secondary" onClick={() => onChange([...blocks, newBlock(type.id)])}>{type.label}</Button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Tag <code>{"{projectCode}"}</code>, <code>{"{clientLegalName}"}</code>, <code>{"{contractValue}"}</code>, dan variabel template lain
        diisi otomatis dari snapshot saat dokumen dibuat. Blok galeri foto hanya terisi untuk template dokumentasi.
      </p>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: EditableBlock; onChange: (block: EditableBlock) => void }) {
  const rows = asRows(block.rows);
  const columns = asRows(block.columns);
  const parties = asRows(block.parties);

  if (block.type === "heading") {
    return <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
      <Field label="Level"><Select value={String(block.level ?? 1)} onChange={(e) => onChange({ ...block, level: Number(e.target.value) })}><option value="1">1</option><option value="2">2</option><option value="3">3</option></Select></Field>
      <Field label="Teks judul"><Input value={asText(block.text)} onChange={(e) => onChange({ ...block, text: e.target.value })} /></Field>
    </div>;
  }
  if (block.type === "paragraph") {
    return <Field label="Teks paragraf"><Textarea value={asText(block.text)} onChange={(e) => onChange({ ...block, text: e.target.value })} /></Field>;
  }
  if (block.type === "spacer") {
    return <Field label="Tinggi (pt)"><Input type="number" min={4} max={200} value={Number(block.height ?? 24)} onChange={(e) => onChange({ ...block, height: Number(e.target.value) })} /></Field>;
  }
  if (block.type === "pageBreak") {
    return <p className="text-[11px] text-muted">Blok ini hanya memindahkan konten berikutnya ke halaman baru.</p>;
  }
  if (block.type === "keyValue") {
    return <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
          <Input placeholder="Label" value={asText(row.label)} onChange={(e) => onChange({ ...block, rows: replace(rows, index, { ...row, label: e.target.value }) })} />
          <Input placeholder="Nilai" value={asText(row.value)} onChange={(e) => onChange({ ...block, rows: replace(rows, index, { ...row, value: e.target.value }) })} />
          <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus baris" onClick={() => onChange({ ...block, rows: rows.filter((_, i) => i !== index) })}><Trash2 size={13} /></Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange({ ...block, rows: [...rows, { label: "", value: "" }] })}><Plus size={13} />Baris</Button>
    </div>;
  }
  if (block.type === "table") {
    return <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-700">Kolom</p>
        <div className="space-y-2">
          {columns.map((column, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
              <Input placeholder="key" value={asText(column.key)} onChange={(e) => {
                const oldKey = asText(column.key);
                const newKey = e.target.value;
                onChange({
                  ...block,
                  columns: replace(columns, index, { ...column, key: newKey }),
                  rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key === oldKey ? newKey : key, value]))),
                });
              }} />
              <Input placeholder="Label" value={asText(column.label)} onChange={(e) => onChange({ ...block, columns: replace(columns, index, { ...column, label: e.target.value }) })} />
              <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus kolom" onClick={() => onChange({
                ...block,
                columns: columns.filter((_, i) => i !== index),
                rows: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== asText(column.key)))),
              })}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => onChange({ ...block, columns: [...columns, { key: `kolom${columns.length + 1}`, label: "" }] })}><Plus size={13} />Kolom</Button>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-700">Baris</p>
        <div className="space-y-2">
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2 sm:grid-cols-2">
                {columns.map((column) => (
                  <Input key={asText(column.key)} placeholder={asText(column.label) || asText(column.key)}
                    value={asText(row[asText(column.key)])}
                    onChange={(e) => onChange({ ...block, rows: replace(rows, rowIndex, { ...row, [asText(column.key)]: e.target.value }) })} />
                ))}
              </div>
              <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus baris" onClick={() => onChange({ ...block, rows: rows.filter((_, i) => i !== rowIndex) })}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => onChange({ ...block, rows: [...rows, Object.fromEntries(columns.map((c) => [asText(c.key), ""]))] })}><Plus size={13} />Baris</Button>
      </div>
    </div>;
  }
  if (block.type === "signature") {
    return <div className="space-y-2">
      {parties.map((party, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="Peran (Untuk Klien)" value={asText(party.label)} onChange={(e) => onChange({ ...block, parties: replace(parties, index, { ...party, label: e.target.value }) })} />
          <Input placeholder="Nama" value={asText(party.name)} onChange={(e) => onChange({ ...block, parties: replace(parties, index, { ...party, name: e.target.value }) })} />
          <Input placeholder="Jabatan" value={asText(party.title)} onChange={(e) => onChange({ ...block, parties: replace(parties, index, { ...party, title: e.target.value }) })} />
          <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus pihak" onClick={() => onChange({ ...block, parties: parties.filter((_, i) => i !== index) })}><Trash2 size={13} /></Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" disabled={parties.length >= 4} onClick={() => onChange({ ...block, parties: [...parties, { label: "", name: "", title: "" }] })}><Plus size={13} />Pihak</Button>
    </div>;
  }
  if (block.type === "photoGallery") {
    const photos = asRows(block.photos);
    return <div className="space-y-2">
      <Field label="Judul galeri"><Input value={asText(block.heading, "LAMPIRAN FOTO LAPANGAN")} onChange={(e) => onChange({ ...block, heading: e.target.value })} /></Field>
      <p className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-paper p-2.5 text-[11px] text-muted">
        <ImageIcon size={13} />{photos.length} foto terpilih dari laporan lapangan. Pilihan foto diubah di tab Foto lapangan proyek.
      </p>
      <Button size="sm" variant="ghost" className="text-danger" disabled={!photos.length} onClick={() => onChange({ ...block, photos: [] })}><Minus size={13} />Kosongkan galeri</Button>
    </div>;
  }
  return null;
}

function replace<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}
