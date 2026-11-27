"use client";
import { useCallback, useEffect, useState } from "react";
import { Layers, Pencil, Plus, Ruler } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import {
  createCostCategory, createUnitRecord, fetchCatalog, updateCostCategory, updateUnitRecord,
  type CatalogCategory, type CatalogUnit,
} from "@/lib/client";

/* Audit DOM-01 (tahap 3): kategori biaya & satuan sebelumnya hanya ada di seed
 * global (`company_id NULL`). Tab ini membuat katalog milik company bisa
 * dikelola dari UI, sementara baris bersama tetap read-only. */

type CatalogData = { categories: CatalogCategory[]; units: CatalogUnit[] };

export default function CatalogTab({ canManage, onSaved }: { canManage: boolean; onSaved: (message: string) => void }) {
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<null | { kind: "category" | "unit"; row: CatalogCategory | CatalogUnit | null }>(null);

  const load = useCallback(() => {
    void fetchCatalog()
      .then((result) => { setData(result); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat katalog."));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return error
      ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p>
      : <p className="text-xs text-muted">Memuat katalog biaya…</p>;
  }

  const done = (message: string) => { setModal(null); load(); onSaved(message); };

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}
      {!canManage ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Peran Anda hanya dapat melihat katalog. Izin <code>settings.manage</code> atau <code>budget.edit</code> diperlukan untuk mengubahnya.</p> : null}

      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <div>
            <h2 className="text-[13px] font-semibold">Kategori biaya</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Dipakai pos RAB, pengeluaran, dan PO. Baris bersama (warisan sistem) tidak dapat diubah.</p>
          </div>
          {canManage ? <Button size="sm" variant="lime" onClick={() => setModal({ kind: "category", row: null })}><Plus size={14} />Kategori</Button> : null}
        </header>
        {!data.categories.length
          ? <div className="p-4"><EmptyState icon={<Layers size={18} />} title="Belum ada kategori" description="Tambahkan kategori biaya pertama untuk company ini." /></div>
          : <div className="divide-y divide-line">
            {data.categories.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-semibold">
                    <span className="mono rounded bg-paper-2 px-1.5 py-0.5 text-[11px]">{row.code}</span>
                    <span className="truncate">{row.name}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {row.shared ? "Katalog bersama" : "Milik company"}
                    {row.isOverhead ? " · overhead" : ""}
                    {row.used ? " · dipakai RAB" : " · belum dipakai"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!row.isActive ? <Badge value="NONAKTIF" tone="neutral" /> : null}
                  {canManage && !row.shared ? <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "category", row })}><Pencil size={13} />Ubah</Button> : null}
                </div>
              </div>
            ))}
          </div>}
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <div>
            <h2 className="text-[13px] font-semibold">Satuan</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Kode satuan tidak dapat diubah setelah dibuat (mis. m2, m3, kg, Ls).</p>
          </div>
          {canManage ? <Button size="sm" variant="lime" onClick={() => setModal({ kind: "unit", row: null })}><Plus size={14} />Satuan</Button> : null}
        </header>
        {!data.units.length
          ? <div className="p-4"><EmptyState icon={<Ruler size={18} />} title="Belum ada satuan" description="Tambahkan satuan pertama untuk company ini." /></div>
          : <div className="grid gap-0 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
            {data.units.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 px-4 py-2.5 sm:border-b sm:border-line">
                <div className="min-w-0">
                  <p className="text-xs font-semibold"><span className="mono">{row.code}</span> · <span className="font-normal text-muted">{row.name}</span></p>
                  <p className="mt-0.5 text-[11px] text-muted">{row.shared ? "Katalog bersama" : "Milik company"}{row.used ? " · dipakai" : ""}</p>
                </div>
                {canManage && !row.shared ? <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "unit", row })}><Pencil size={13} />Ubah</Button> : null}
              </div>
            ))}
          </div>}
      </section>

      {modal ? <CatalogModal
        kind={modal.kind}
        row={modal.row}
        onClose={() => setModal(null)}
        onDone={done}
      /> : null}
    </div>
  );
}

function CatalogModal({ kind, row, onClose, onDone }: {
  kind: "category" | "unit";
  row: CatalogCategory | CatalogUnit | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const category = kind === "category" && row ? (row as CatalogCategory) : null;
  const [form, setForm] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    isOverhead: category?.isOverhead ?? false,
    isActive: category?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      if (kind === "category") {
        const payload = { code: form.code, name: form.name, isOverhead: form.isOverhead, isActive: form.isActive };
        if (row) await updateCostCategory(row.id, payload);
        else await createCostCategory(payload);
        onDone(row ? `Kategori ${form.code} diperbarui.` : `Kategori ${form.code} dibuat.`);
      } else {
        const payload = { code: form.code, name: form.name };
        if (row) await updateUnitRecord(row.id, payload);
        else await createUnitRecord(payload);
        onDone(row ? `Satuan ${form.code} diperbarui.` : `Satuan ${form.code} dibuat.`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan katalog."); } finally { setSaving(false); }
  };

  return <Modal open onClose={onClose} eyebrow={row ? "Ubah" : "Baru"} title={kind === "category" ? "Kategori biaya" : "Satuan"}>
    <div className="grid gap-4">
      <Field label="Kode" hint={kind === "unit" ? "Kode satuan tidak dapat diubah setelah dibuat." : "Huruf besar/angka. Kode terkunci bila sudah dipakai RAB."}>
        <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={kind === "unit" && !!row} data-autofocus placeholder={kind === "unit" ? "m2" : "MAT"} />
      </Field>
      <Field label="Nama"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={kind === "unit" ? "Meter persegi" : "Material"} /></Field>
      {kind === "category" ? <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis"><Select value={form.isOverhead ? "1" : "0"} onChange={(e) => setForm({ ...form, isOverhead: e.target.value === "1" })}><option value="0">Biaya langsung</option><option value="1">Overhead</option></Select></Field>
        <Field label="Status"><Select value={form.isActive ? "1" : "0"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "1" })}><option value="1">Aktif</option><option value="0">Nonaktif</option></Select></Field>
      </div> : null}
    </div>
    {error ? <p className="mt-3 rounded-[var(--radius-control)] bg-danger-bg p-2.5 text-xs text-danger">{error}</p> : null}
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>Batal</Button>
      <Button loading={saving} onClick={() => void save()}>Simpan</Button>
    </div>
  </Modal>;
}
