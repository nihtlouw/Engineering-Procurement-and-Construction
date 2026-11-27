"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, FileCode2, FileText, History, Lock, Plus, Power, RefreshCw, Upload } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import {
  createTemplateRecord, deactivateTemplateRecord, duplicateTemplateRecord, fetchTemplateVersions,
  fetchTemplates, updateTemplateRecord, uploadTemplateDocx,
  type DocumentTemplateView, type TemplateCatalog, type TemplatePayload, type TemplateVariableView,
} from "@/lib/client";
import BlockEditor, { type EditableBlock } from "@/components/documents/BlockEditor";

/* Audit #10 / S4: template dokumen dikelola admin lewat DB, bukan hardcode di
 * `src/lib/document-templates.ts`. Template sistem (company_id NULL) read-only;
 * admin company menduplikatnya menjadi varian yang bisa diedit. */

export default function TemplateAdmin({ canManage, onSaved }: { canManage: boolean; onSaved: (message: string) => void }) {
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<DocumentTemplateView | "new" | null>(null);

  const load = useCallback(() => fetchTemplates()
    .then((data) => { setCatalog(data); setError(""); })
    .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat template.")), []);
  useEffect(() => { void load(); }, [load]);

  const duplicate = async (template: DocumentTemplateView) => {
    try {
      const created = await duplicateTemplateRecord(template.id);
      onSaved(`Template ${template.code} diduplikat menjadi ${created.code} (bisa diedit).`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menduplikat template."); }
  };

  const deactivate = async (template: DocumentTemplateView) => {
    const reason = window.prompt(`Alasan menonaktifkan template ${template.code}? (min. 5 karakter)`);
    if (!reason) return;
    try {
      await deactivateTemplateRecord(template.id, reason);
      onSaved(`Template ${template.code} dinonaktifkan.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menonaktifkan template."); }
  };

  if (!catalog) {
    return error
      ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p>
      : <p className="text-xs text-muted">Memuat template dokumen…</p>;
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}
      {!canManage ? <p className="rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Peran Anda hanya dapat melihat template. Izin <code>template.manage</code> diperlukan untuk mengubah.</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] leading-relaxed text-muted">
          {catalog.templates.length} template · {catalog.templates.filter((t) => t.isSystem).length} sistem (read-only) ·
          ubah template tanpa deploy ulang.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" aria-label="Muat ulang template" onClick={() => void load()}><RefreshCw size={14} />Muat ulang</Button>
          {canManage ? <Button size="sm" variant="lime" onClick={() => setEditing("new")}><Plus size={14} />Template baru</Button> : null}
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {catalog.templates.map((template) => (
          <article key={template.id} className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="mono rounded bg-paper-2 px-1.5 py-0.5 text-[10.5px] font-semibold">{template.code}</span>
                  <Badge value={template.isActive ? "AKTIF" : "NONAKTIF"} tone={template.isActive ? "ok" : "neutral"} />
                  {template.isSystem ? <span className="inline-flex items-center gap-1 text-[10.5px] text-muted"><Lock size={10} />sistem</span> : null}
                </p>
                <h3 className="mt-1.5 truncate text-[13px] font-semibold">{template.name}</h3>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{template.description || "Tanpa deskripsi"}</p>
              </div>
              <span className="shrink-0 text-right">
                <span className="mono block text-[10.5px] text-muted">v{template.version}</span>
                <span className="mono block text-[10px] text-subtle">{template.kind === "DOCX" ? "DOCX" : `${template.blockCount} blok`}</span>
              </span>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
              <span>{template.variableCount} variabel</span>
              <span>{template.category}</span>
              {template.used ? <span className="text-ok">dipakai dokumen</span> : <span>belum dipakai</span>}
            </p>
            {canManage ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-2.5">
              {template.isSystem
                ? <Button size="sm" variant="secondary" onClick={() => void duplicate(template)}><Copy size={13} />Duplikat & ubah</Button>
                : <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(template)}><FileText size={13} />Ubah</Button>
                  <Button size="sm" variant="ghost" onClick={() => void duplicate(template)}><Copy size={13} />Duplikat</Button>
                  {template.isActive ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => void deactivate(template)}><Power size={13} />Nonaktifkan</Button> : null}
                </>}
            </div> : null}
          </article>
        ))}
      </div>

      {!catalog.templates.length ? <EmptyState icon={<FileText />} title="Belum ada template" description="Buat template blok atau unggah .docx dengan placeholder {tag}." /> : null}

      {editing ? <TemplateModal
        template={editing === "new" ? null : editing}
        defaults={catalog.defaults}
        variables={editing === "new" ? catalog.defaults : catalog.variables.filter((v) => v.templateId === editing.id)}
        onClose={() => setEditing(null)}
        onDone={(message) => { setEditing(null); onSaved(message); void load(); }}
      /> : null}
    </div>
  );
}

function TemplateModal({ template, defaults, variables, onClose, onDone }: {
  template: DocumentTemplateView | null;
  defaults: TemplateVariableView[];
  variables: TemplateVariableView[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    code: template?.code ?? "", name: template?.name ?? "", description: template?.description ?? "",
    category: template?.category ?? "OTHER", kind: (template?.kind ?? "BLOCKS") as "BLOCKS" | "DOCX",
    isActive: template?.isActive ?? true,
  });
  const [blocks, setBlocks] = useState<EditableBlock[]>((template?.blocks ?? []) as EditableBlock[]);
  const [docx, setDocx] = useState<{ fileId: string; tags: string[]; fileName: string } | null>(
    template?.docxFileId ? { fileId: template.docxFileId, tags: [], fileName: "template.docx" } : null,
  );
  const [vars, setVars] = useState<TemplateVariableView[]>(variables.length ? variables : defaults);
  const [versions, setVersions] = useState<{ version: number; note: string | null; createdAt: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const loadVersions = useCallback(() => {
    if (!template) return;
    void fetchTemplateVersions(template.id)
      .then((rows) => setVersions(rows))
      .catch(() => setVersions([]));
  }, [template]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const result = await uploadTemplateDocx(file);
      setDocx({ fileId: result.fileId, tags: result.tags, fileName: file.name });
      // Tag baru dari DOCX otomatis menjadi variabel (sumber harus dipilih manual).
      const known = new Set(vars.map((v) => v.tag));
      const additions = result.tags.filter((tag) => !known.has(tag)).map<TemplateVariableView>((tag) => ({
        tag, label: tag, varType: "TEXT", source: "project.code", isRequired: false,
      }));
      if (additions.length) setVars((old) => [...old, ...additions]);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload template gagal."); } finally { setUploading(false); }
  };

  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload: TemplatePayload = {
        code: form.code, name: form.name, description: form.description || null,
        category: form.category, kind: form.kind, isActive: form.isActive,
        blocks: form.kind === "BLOCKS" ? blocks : undefined,
        docxFileId: docx?.fileId ?? null,
        variables: vars.filter((v) => v.tag.trim().length > 1),
        baseCode: template?.baseCode ?? null,
      };
      if (template) {
        const result = await updateTemplateRecord(template.id, payload);
        onDone(result.contentChanged ? `Template ${form.code} diperbarui (v${result.version}).` : `Template ${form.code} diperbarui.`);
      } else {
        await createTemplateRecord(payload);
        onDone(`Template ${form.code} dibuat.`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan template."); } finally { setSaving(false); }
  };

  return <Modal open onClose={onClose} wide eyebrow={template ? `v${template.version} · ${template.used ? "dipakai" : "belum dipakai"}` : "Template baru"}
    title={template ? `Ubah template ${template.code}` : "Template dokumen baru"}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Kode" hint="Huruf besar/angka/garis bawah, mis. BAST1_CUSTOM."><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-autofocus /></Field>
      <Field label="Nama template"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Deskripsi" className="sm:col-span-2"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Kategori arsip"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{["BA", "CONTRACT", "OTHER", "DESIGN", "TEST_REPORT"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Jenis template"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "BLOCKS" | "DOCX" })}><option value="BLOCKS">Blok terstruktur</option><option value="DOCX">Berkas .docx admin</option></Select></Field>
      <Field label="Status"><Select value={form.isActive ? "1" : "0"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "1" })}><option value="1">Aktif</option><option value="0">Nonaktif</option></Select></Field>
      <div className="flex items-end"><label className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface px-3 py-2.5">
        <input type="file" accept=".docx" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        <Upload size={15} className="text-muted" />
        <span className="text-[11.5px] font-semibold">{uploading ? "Mengunggah…" : docx ? "Ganti berkas .docx" : "Unggah berkas .docx"}</span>
      </label></div>
    </div>

    {docx ? <p className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-paper p-2.5 text-[11px] text-muted">
      <FileCode2 size={13} />{docx.fileName || "template.docx"}
      {docx.tags.length ? <span className="mono text-subdued">{docx.tags.slice(0, 12).map((t) => `{${t}}`).join(" ")}</span> : null}
    </p> : null}

    {form.kind === "BLOCKS" ? <div className="mt-5">
      <p className="mb-2 text-xs font-semibold">Blok dokumen</p>
      <BlockEditor blocks={blocks} onChange={setBlocks} />
    </div> : null}

    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Variabel merge</p>
        <Button size="sm" variant="secondary" onClick={() => setVars((old) => [...old, { tag: "", label: "", varType: "TEXT", source: "project.code", isRequired: false }])}><Plus size={13} />Variabel</Button>
      </div>
      <div className="space-y-2">
        {vars.map((variable, index) => (
          <div key={index} className="grid gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-2.5 sm:grid-cols-[1fr_1fr_150px_1fr_auto]">
            <Input placeholder="tag (projectCode)" value={variable.tag} onChange={(e) => setVars((old) => old.map((v, i) => i === index ? { ...v, tag: e.target.value } : v))} />
            <Input placeholder="Label" value={variable.label} onChange={(e) => setVars((old) => old.map((v, i) => i === index ? { ...v, label: e.target.value } : v))} />
            <Select value={variable.varType} onChange={(e) => setVars((old) => old.map((v, i) => i === index ? { ...v, varType: e.target.value } : v))}>
              {["TEXT", "MONEY", "DATE", "ROW_LIST", "PHOTOS"].map((t) => <option key={t}>{t}</option>)}
            </Select>
            <Input placeholder="source (project.code)" value={variable.source} onChange={(e) => setVars((old) => old.map((v, i) => i === index ? { ...v, source: e.target.value } : v))} />
            <Button size="sm" variant="ghost" className="text-danger" aria-label="Hapus variabel" onClick={() => setVars((old) => old.filter((_, i) => i !== index))}><Power size={13} /></Button>
          </div>
        ))}
        {!vars.length ? <p className="text-[11px] text-muted">Belum ada variabel. Tag di dalam blok akan dibiarkan apa adanya bila tidak terdefinisi.</p> : null}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">Sumber yang sah: <code>project.code</code>, <code>client.legalName</code>, <code>invoice.total</code>, <code>budget.rows</code>, <code>schedule.rows</code>, <code>photos.selected</code>, dan sejenisnya (lihat validasi server).</p>
    </div>

    {template && versions.length ? <div className="mt-5 rounded-[var(--radius-control)] border border-line bg-paper p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold"><History size={13} />Riwayat versi</p>
      <ul className="space-y-1">
        {versions.slice(-6).reverse().map((version) => (
          <li key={version.version} className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>v{version.version} · {version.note || "perubahan"}</span>
            <span className="mono">{new Date(version.createdAt).toISOString().slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div> : null}

    {error ? <p className="mt-3 rounded-[var(--radius-control)] bg-danger-bg p-2.5 text-xs text-danger">{error}</p> : null}
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>Batal</Button>
      <Button loading={saving} onClick={() => void save()}>Simpan template</Button>
    </div>
  </Modal>;
}
