"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Pencil, Plus, Trash2, UserRoundPlus, Users } from "lucide-react";
import type { AppData, ProjectView } from "@/components/types";
import { Badge, Button, EmptyState, Field, Input, Modal, SectionTitle, Select, Textarea } from "@/components/ui";
import {
  addProjectMember, archiveClientRecord, createClientRecord, createProjectRecord, createSiteRecord,
  fetchMasterDataOptions, removeProjectMember, updateClientRecord, updateProject, updateSiteRecord,
  type MasterDataOptions, type ProjectMemberView,
} from "@/lib/client";
import { LABELS } from "@/lib/domain";
import { formatDate, formatIDR } from "@/lib/format";

/* Audit DOM-01: sebelum ini proyek/klien/site/anggota hanya bisa dibuat lewat
 * `scripts/seed-demo.ts`. Layar ini menutup celah tersebut dengan wizard 3 langkah
 * (proyek → kontrak → tim) memakai endpoint `/api/projects` + `/api/clients` + `/api/sites`. */

type Tab = "projects" | "clients" | "sites" | "members";

const TABS: { id: Tab; label: string }[] = [
  { id: "projects", label: "Proyek" },
  { id: "clients", label: "Klien" },
  { id: "sites", label: "Site" },
  { id: "members", label: "Anggota" },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function MasterDataView({ data, onSaved }: { data: AppData; onSaved: (message: string) => void }) {
  const canEdit = data.user.permissions.includes("schedule.edit");
  const [tab, setTab] = useState<Tab>("projects");
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectView | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [memberProjectId, setMemberProjectId] = useState<string>("");

  // Opsi form dimuat saat modal dibuka (bukan saat SSR) supaya payload awal tetap kecil.
  // Tidak ada state di sini: tiap modal memegang salinannya sendiri (mount per open).
  const loadOptions = () => fetchMasterDataOptions();

  const projects = data.projects;
  const clients = data.clients as { id: string; code: string; displayName: string; legalName: string; industry: string; npwp?: string; address?: string; contactName?: string; contactPhone?: string; deletedAt?: string | null }[];
  const sites = data.sites as { id: string; clientId: string; name: string; address: string | null; contact?: string }[];
  const clientName = (id: string) => clients.find((c) => c.id === id)?.displayName ?? "—";

  return (
    <div>
      <SectionTitle
        eyebrow="Master data"
        title="Proyek, klien, site & anggota"
        description="Buat proyek baru tanpa menyentuh kode/seed. Tahap awal proyek selalu Menunggu Kickoff, lalu naik lewat gerbang tahap di workspace proyek."
        action={canEdit ? (
          <div className="flex flex-wrap gap-2">
            {tab === "projects" ? <Button variant="lime" onClick={() => { setError(""); setWizardOpen(true); }}><Plus size={15} />Proyek baru</Button> : null}
            {tab === "clients" ? <Button variant="lime" onClick={() => { setError(""); setEditingClientId(null); setClientOpen(true); }}><Plus size={15} />Klien baru</Button> : null}
            {tab === "sites" ? <Button variant="lime" onClick={() => { setError(""); setEditingSiteId(null); setSiteOpen(true); }}><Plus size={15} />Site baru</Button> : null}
          </div>
        ) : null}
      />

      <div role="tablist" aria-label="Bagian master data" className="mb-4 flex flex-wrap gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface p-1">
        {TABS.map((item) => (
          <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`min-h-9 rounded-[var(--radius-control)] px-3 text-xs font-semibold transition-colors ${tab === item.id ? "bg-ink text-white" : "text-muted hover:bg-paper-2"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-4 rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}
      {!canEdit ? <p className="mb-4 rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-warn">Peran Anda hanya dapat melihat. Izin <code>schedule.edit</code> diperlukan untuk mengubah master data.</p> : null}

      {tab === "projects" ? (
        !projects.length ? <EmptyState icon={<Building2 size={18} />} title="Belum ada proyek" description="Buat proyek pertama dengan wizard tiga langkah: data proyek, kontrak, lalu tim." action={canEdit ? <Button onClick={() => setWizardOpen(true)}><Plus size={15} />Proyek baru</Button> : undefined} /> : (
          <div className="space-y-2.5">
            {projects.map((project) => (
              <article key={project.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge value={project.stage} /><span className="mono text-[11px] font-semibold text-muted">{project.code}</span>{project.isLocked ? <Badge value="CLOSED" tone="info" /> : null}</div>
                    <h3 className="mt-1.5 text-[13.5px] font-semibold">{project.title}</h3>
                    <p className="mt-1 text-[11.5px] text-muted">{project.clientName} · {project.siteName || "Site belum ditetapkan"} · PM {project.pmName || "belum ditetapkan"}</p>
                    <p className="mt-1 text-[11px] text-muted">{project.contractNumber ? `Kontrak ${project.contractNumber}` : "Nomor kontrak belum diisi"} · {formatDate(project.contractDate)} → {formatDate(project.targetEndDate)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right"><p className="text-[11px] text-muted">Nilai berjalan</p><p className="mono text-[12.5px] font-semibold tabular">{formatIDR(project.contractValueCurrent, true)}</p></div>
                    {canEdit ? <Button size="sm" variant="secondary" onClick={() => { setError(""); setEditingProject(project); }}><Pencil size={13} />Ubah</Button> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === "clients" ? (
        !clients.length ? <EmptyState icon={<Building2 size={18} />} title="Belum ada klien" description="Klien wajib ada sebelum proyek dibuat." /> : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {clients.map((client) => (
              <article key={client.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="mono text-[11px] font-semibold text-muted">{client.code}</p>
                    <h3 className="mt-1 truncate text-[13px] font-semibold">{client.displayName}</h3>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted">{client.legalName}</p>
                    <p className="mt-1 text-[11px] text-muted">{client.industry}{client.npwp ? ` · NPWP ${client.npwp}` : ""}</p>
                    {client.contactName ? <p className="mt-1 text-[11px] text-muted">Kontak: {client.contactName}{client.contactPhone ? ` · ${client.contactPhone}` : ""}</p> : null}
                  </div>
                  {canEdit ? <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setError(""); setEditingClientId(client.id); setClientOpen(true); }}><Pencil size={13} />Ubah</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => void archive(client)}><Trash2 size={13} />Arsip</Button>
                  </div> : null}
                </div>
                {client.deletedAt ? <p className="mt-2 text-[11px] text-danger">Diarsipkan {formatDate(client.deletedAt)}</p> : null}
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === "sites" ? (
        !sites.length ? <EmptyState icon={<MapPin size={18} />} title="Belum ada site" description="Site membantu tim lapangan memilih lokasi saat mencatat biaya dan foto." /> : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {sites.map((site) => (
              <article key={site.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-muted">{clientName(site.clientId)}</p>
                    <h3 className="mt-1 truncate text-[13px] font-semibold">{site.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{site.address || "Alamat belum diisi"}</p>
                  </div>
                  {canEdit ? <Button size="sm" variant="ghost" onClick={() => { setError(""); setEditingSiteId(site.id); setSiteOpen(true); }}><Pencil size={13} />Ubah</Button> : null}
                </div>
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === "members" ? <MembersTab data={data} canEdit={canEdit} selected={memberProjectId} onSelect={setMemberProjectId} onSaved={onSaved} onNeedOptions={loadOptions} /> : null}

      {editingProject ? <ProjectEditModal
        project={editingProject}
        sites={sites}
        onClose={() => setEditingProject(null)}
        onDone={(message) => { setEditingProject(null); onSaved(message); }}
      /> : null}
      {/* Modal di-mount hanya saat terbuka: initial state form dibaca sekali per open. */}
      {wizardOpen ? <ProjectWizard
        onClose={() => setWizardOpen(false)}
        onNeedOptions={loadOptions}
        onDone={(message) => { setWizardOpen(false); onSaved(message); }}
      /> : null}
      {clientOpen ? <ClientModal
        editing={editingClientId ? clients.find((c) => c.id === editingClientId) ?? null : null}
        onClose={() => { setClientOpen(false); setEditingClientId(null); }}
        onDone={(message) => { setClientOpen(false); setEditingClientId(null); onSaved(message); }}
      /> : null}
      {siteOpen ? <SiteModal
        clients={clients}
        editing={editingSiteId ? sites.find((s) => s.id === editingSiteId) ?? null : null}
        onClose={() => { setSiteOpen(false); setEditingSiteId(null); }}
        onDone={(message) => { setSiteOpen(false); setEditingSiteId(null); onSaved(message); }}
      /> : null}
    </div>
  );

  async function archive(client: { id: string; displayName: string }) {
    setError("");
    try {
      await archiveClientRecord(client.id);
      onSaved(`${client.displayName} diarsipkan.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengarsipkan klien."); }
  }
}

/* -------------------------------------------------------------------------- */
/* Wizard proyek (3 langkah)                                                   */
/* -------------------------------------------------------------------------- */

function ProjectWizard({ onClose, onNeedOptions, onDone }: {
  onClose: () => void; onNeedOptions: () => Promise<MasterDataOptions>; onDone: (message: string) => void;
}) {
  const blank = { title: "", clientId: "", siteId: "", pmId: "", contractNumber: "", contractDate: "", contractValue: "", retentionPct: "5", warrantyMonths: "12", startDate: "", targetEndDate: "", code: "" };
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(blank);
  const [members, setMembers] = useState<{ userId: string; projectRole: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inline, setInline] = useState<null | "client" | "site">(null);
  const [quick, setQuick] = useState({ name: "", industry: "Energi", address: "" });
  const [localOptions, setLocalOptions] = useState<MasterDataOptions | null>(null);

  // Opsi form dimuat sekali saat wizard dibuka; retry manual bila gagal.
  const loadOptions = useCallback(() => {
    void onNeedOptions().then(setLocalOptions).catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat opsi."));
  }, [onNeedOptions]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const sitesForClient = useMemo(
    () => (localOptions?.sites ?? []).filter((s) => !form.clientId || s.clientId === form.clientId),
    [localOptions, form.clientId],
  );

  const set = (key: keyof typeof blank, value: string) => setForm((old) => ({ ...old, [key]: value }));

  const validateStep = () => {
    if (step === 1) {
      if (form.title.trim().length < 5) return "Nama proyek minimal 5 karakter.";
      if (!form.clientId) return "Klien wajib dipilih (atau buat klien baru di langkah ini).";
    }
    if (step === 2 && form.startDate && form.targetEndDate && form.targetEndDate < form.startDate) {
      return "Target selesai tidak boleh sebelum tanggal mulai.";
    }
    return "";
  };

  const next = () => { const message = validateStep(); if (message) { setError(message); return; } setError(""); setStep((s) => Math.min(3, s + 1)); };

  const submit = async () => {
    const message = validateStep();
    if (message) { setError(message); return; }
    setSaving(true); setError("");
    try {
      const result = await createProjectRecord({
        code: form.code.trim() || undefined,
        title: form.title, clientId: form.clientId,
        siteId: form.siteId || null, pmId: form.pmId || null,
        contractNumber: form.contractNumber || null,
        contractDate: form.contractDate || null,
        contractValue: form.contractValue || "0",
        retentionPct: form.retentionPct || "5",
        warrantyMonths: Number(form.warrantyMonths || 12),
        startDate: form.startDate || null, targetEndDate: form.targetEndDate || null,
        members,
      });
      onDone(`Proyek ${result.code} dibuat (${result.members} anggota). Lanjutkan ke RAB & PO dari workspace proyek.`);
      setForm(blank); setMembers([]); setStep(1);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat proyek."); } finally { setSaving(false); }
  };

  const quickCreate = async () => {
    if (quick.name.trim().length < 2) { setError("Nama minimal 2 karakter."); return; }
    setSaving(true); setError("");
    try {
      if (inline === "client") {
        const created = await createClientRecord({ legalName: quick.name, displayName: quick.name, industry: quick.industry, address: quick.address || null });
        const nextOptions = await onNeedOptions();
        setLocalOptions(nextOptions);
        set("clientId", created.id);
        onDone(`Klien ${created.code} dibuat.`);
      } else {
        if (!form.clientId) { setError("Pilih klien lebih dulu."); return; }
        const created = await createSiteRecord({ clientId: form.clientId, name: quick.name, address: quick.address || null });
        const nextOptions = await onNeedOptions();
        setLocalOptions(nextOptions);
        set("siteId", created.id);
      }
      setInline(null); setQuick({ name: "", industry: "Energi", address: "" });
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat data cepat."); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Proyek baru" eyebrow={`Langkah ${step} dari 3`} wide>
      <ol className="mb-4 flex gap-2 text-[11px] font-semibold" aria-label="Langkah wizard">
        {["Data proyek", "Kontrak", "Tim"].map((label, index) => (
          <li key={label} className={`flex-1 rounded-[var(--radius-control)] border px-2 py-1.5 text-center ${step === index + 1 ? "border-ink bg-ink text-white" : step > index + 1 ? "border-line-strong bg-paper-2 text-ink" : "border-line text-muted"}`}>{index + 1}. {label}</li>
        ))}
      </ol>

      {step === 1 ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama proyek" className="sm:col-span-2"><Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="mis. Instalasi Genset 2×800 kVA" data-autofocus /></Field>
        <Field label="Klien" hint="Belum ada klien? Gunakan tombol di bawah.">
          <Select value={form.clientId} onChange={(e) => { set("clientId", e.target.value); set("siteId", ""); }}>
            <option value="">Pilih klien</option>
            {(localOptions?.clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.displayName} · {c.code}</option>)}
          </Select>
        </Field>
        <Field label="Site (opsional)" hint={form.clientId ? "Daftar disaring sesuai klien." : "Pilih klien lebih dulu."}>
          <Select value={form.siteId} disabled={!form.clientId} onChange={(e) => set("siteId", e.target.value)}>
            <option value="">Belum ditetapkan</option>
            {sitesForClient.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Kode proyek (opsional)" hint="Kosongkan untuk kode otomatis PRJ-YYYY-NNN."><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="otomatis" /></Field>
        <Field label="PM proyek (opsional)" hint="PM otomatis menjadi anggota proyek.">
          <Select value={form.pmId} onChange={(e) => set("pmId", e.target.value)}>
            <option value="">Belum ditetapkan</option>
            {(localOptions?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.title}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setInline(inline === "client" ? null : "client"); setError(""); }}><Plus size={13} />Klien baru cepat</Button>
          <Button size="sm" variant="secondary" disabled={!form.clientId} onClick={() => { setInline(inline === "site" ? null : "site"); setError(""); }}><MapPin size={13} />Site baru cepat</Button>
        </div>
        {inline ? <div className="sm:col-span-2 rounded-[var(--radius-card)] border border-line-strong bg-paper p-3">
          <p className="mb-2 text-xs font-semibold">{inline === "client" ? "Klien baru" : `Site baru untuk ${(localOptions?.clients ?? []).find((c) => c.id === form.clientId)?.displayName ?? "—"}`}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={inline === "client" ? "Nama klien" : "Nama site"}><Input value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} /></Field>
            {inline === "client" ? <Field label="Industri"><Input value={quick.industry} onChange={(e) => setQuick({ ...quick, industry: e.target.value })} /></Field> : null}
            <Field label="Alamat" className="sm:col-span-2"><Input value={quick.address} onChange={(e) => setQuick({ ...quick, address: e.target.value })} /></Field>
          </div>
          <Button size="sm" className="mt-3" loading={saving} onClick={() => void quickCreate()}>Simpan {inline === "client" ? "klien" : "site"}</Button>
        </div> : null}
      </div> : null}

      {step === 2 ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nomor kontrak"><Input value={form.contractNumber} onChange={(e) => set("contractNumber", e.target.value)} placeholder="mis. 042/SPK/XI/2026" /></Field>
        <Field label="Tanggal kontrak"><Input type="date" value={form.contractDate} onChange={(e) => set("contractDate", e.target.value)} /></Field>
        <Field label="Nilai kontrak DPP (IDR)" hint={form.contractValue ? formatIDR(form.contractValue, true) : "Boleh dikosongkan; isi saat RAB klien disusun."}><Input inputMode="decimal" value={form.contractValue} onChange={(e) => set("contractValue", e.target.value)} placeholder="0" /></Field>
        <Field label="Retensi (%)"><Input inputMode="decimal" value={form.retentionPct} onChange={(e) => set("retentionPct", e.target.value)} /></Field>
        <Field label="Masa garansi (bulan)"><Input type="number" min={0} max={120} value={form.warrantyMonths} onChange={(e) => set("warrantyMonths", e.target.value)} /></Field>
        <div className="hidden sm:block" />
        <Field label="Tanggal mulai"><Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="Target selesai"><Input type="date" value={form.targetEndDate} onChange={(e) => set("targetEndDate", e.target.value)} /></Field>
      </div> : null}

      {step === 3 ? <div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-muted">Anggota menentukan siapa yang bisa membuka proyek ini. Peran company tetap yang menentukan izin; peran proyek hanya label penugasan.</p>
        <MemberPicker
          options={localOptions}
          members={members}
          onChange={setMembers}
          pmId={form.pmId}
        />
      </div> : null}

      {error ? <p className="mt-3 rounded-[var(--radius-control)] bg-danger-bg p-2.5 text-xs text-danger">{error}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>{step === 1 ? "Batal" : "Kembali"}</Button>
        {step < 3 ? <Button variant="lime" onClick={next}>Lanjut</Button> : <Button variant="lime" loading={saving} onClick={() => void submit()}><Building2 size={15} />Buat proyek</Button>}
      </div>
    </Modal>
  );
}

function ProjectEditModal({ project, sites, onClose, onDone }: {
  project: ProjectView;
  sites: { id: string; clientId: string; name: string }[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    title: project.title, siteId: project.siteId ?? "", pmId: project.pmId ?? "",
    contractNumber: project.contractNumber ?? "", contractDate: project.contractDate ?? "",
    contractValue: project.contractValueCurrent && project.contractValueCurrent !== "" ? String(project.contractValueCurrent) : "",
    retentionPct: project.retentionPct || "5", warrantyMonths: String(project.warrantyMonths ?? 12),
    startDate: project.startDate ?? "", targetEndDate: project.targetEndDate ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      // Hanya field yang berubah yang dikirim agar nilai kontrak tidak tertimpa
      // nilai berjalan (CO/PTK) dengan angka lama.
      const payload: Record<string, unknown> = {};
      if (form.title.trim() !== project.title) payload.title = form.title.trim();
      if ((form.siteId || null) !== project.siteId) payload.siteId = form.siteId || null;
      if ((form.pmId || null) !== project.pmId) payload.pmId = form.pmId || null;
      if ((form.contractNumber || null) !== project.contractNumber) payload.contractNumber = form.contractNumber || null;
      if ((form.contractDate || null) !== project.contractDate) payload.contractDate = form.contractDate || null;
      if ((form.startDate || null) !== project.startDate) payload.startDate = form.startDate || null;
      if ((form.targetEndDate || null) !== project.targetEndDate) payload.targetEndDate = form.targetEndDate || null;
      if (form.retentionPct !== project.retentionPct) payload.retentionPct = form.retentionPct;
      if (Number(form.warrantyMonths) !== project.warrantyMonths) payload.warrantyMonths = Number(form.warrantyMonths);
      if (form.contractValue && form.contractValue !== String(project.contractValueCurrent ?? "")) payload.contractValue = form.contractValue;
      if (!Object.keys(payload).length) { onClose(); return; }
      const result = await updateProject(project.id, payload);
      onDone(`${project.code}: ${result.changed} field diperbarui.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan proyek."); } finally { setSaving(false); }
  };
  return <Modal open onClose={onClose} title="Ubah proyek" eyebrow={project.code}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nama proyek" className="sm:col-span-2"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-autofocus /></Field>
      <Field label="Site"><Select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">Belum ditetapkan</option>{sites.filter((s) => s.clientId === project.clientId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Nomor kontrak"><Input value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} /></Field>
      <Field label="Tanggal kontrak"><Input type="date" value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></Field>
      <Field label="Nilai kontrak dasar (DPP)" hint="Nilai berjalan (termasuk CO/PTK) dihitung ulang oleh trigger."><Input inputMode="decimal" value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} /></Field>
      <Field label="Retensi (%)"><Input inputMode="decimal" value={form.retentionPct} onChange={(e) => setForm({ ...form, retentionPct: e.target.value })} /></Field>
      <Field label="Masa garansi (bulan)"><Input type="number" min={0} max={120} value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} /></Field>
      <Field label="Tanggal mulai"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
      <Field label="Target selesai"><Input type="date" value={form.targetEndDate} onChange={(e) => setForm({ ...form, targetEndDate: e.target.value })} /></Field>
    </div>
    <p className="mt-3 rounded-[var(--radius-control)] bg-paper p-3 text-[11px] leading-relaxed text-muted">PM ditugaskan dari tab <strong>Anggota</strong> agar baris keanggotaan proyek ikut tercatat.</p>
    {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    <Button className="mt-5 w-full" loading={saving} onClick={() => void save()}>Simpan perubahan</Button>
  </Modal>;
}

function MemberPicker({ options, members, onChange, pmId }: {
  options: MasterDataOptions | null; members: { userId: string; projectRole: string }[];
  onChange: (members: { userId: string; projectRole: string }[]) => void; pmId: string;
}) {
  const [pick, setPick] = useState({ userId: "", projectRole: "FIELD" });
  const users = options?.users ?? [];
  const available = users.filter((u) => !members.some((m) => m.userId === u.id));
  return <div>
    <div className="grid gap-3 sm:grid-cols-[1fr_170px_auto]">
      <Field label="Pengguna"><Select value={pick.userId} onChange={(e) => setPick({ ...pick, userId: e.target.value })}><option value="">Pilih pengguna</option>{available.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</Select></Field>
      <Field label="Peran proyek"><Select value={pick.projectRole} onChange={(e) => setPick({ ...pick, projectRole: e.target.value })}>{(options?.projectRoles ?? ["PM", "FIELD"]).map((role) => <option key={role} value={role}>{LABELS[role] ?? role}</option>)}</Select></Field>
      <div className="flex items-end"><Button variant="secondary" onClick={() => { if (!pick.userId) return; onChange([...members, pick]); setPick({ userId: "", projectRole: pick.projectRole }); }}><UserRoundPlus size={15} />Tambah</Button></div>
    </div>
    <div className="mt-3 space-y-2">
      {members.length ? members.map((m) => <div key={`${m.userId}-${m.projectRole}`} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-3">
        <div className="min-w-0"><p className="truncate text-xs font-semibold">{users.find((u) => u.id === m.userId)?.name ?? m.userId}{m.userId === pmId ? " · PM terpilih" : ""}</p><p className="text-[11px] text-muted">{LABELS[m.projectRole] ?? m.projectRole}</p></div>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => onChange(members.filter((x) => !(x.userId === m.userId && x.projectRole === m.projectRole)))}><Trash2 size={13} />Hapus</Button>
      </div>) : <p className="rounded-[var(--radius-control)] bg-paper p-3 text-[11.5px] text-muted">Belum ada anggota tambahan. PM (bila dipilih) ditambahkan otomatis.</p>}
    </div>
  </div>;
}

/* -------------------------------------------------------------------------- */
/* Modal klien & site                                                         */
/* -------------------------------------------------------------------------- */

function ClientModal({ editing, onClose, onDone }: {
  editing: { id: string; code: string; displayName: string; legalName: string; industry: string; npwp?: string; address?: string; contactName?: string; contactPhone?: string } | null;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [form, setForm] = useState(() => (editing
    ? { legalName: editing.legalName, displayName: editing.displayName, industry: editing.industry, npwp: editing.npwp ?? "", address: editing.address ?? "", contactName: editing.contactName ?? "", contactPhone: editing.contactPhone ?? "" }
    : { legalName: "", displayName: "", industry: "", npwp: "", address: "", contactName: "", contactPhone: "" }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload = { ...form, npwp: form.npwp || null, address: form.address || null, contactName: form.contactName || null, contactPhone: form.contactPhone || null };
      if (editing) { const r = await updateClientRecord(editing.id, payload); onDone(`${editing.displayName} diperbarui (${r.changed} field).`); }
      else { const r = await createClientRecord(payload); onDone(`Klien ${r.code} dibuat.`); }
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan klien."); } finally { setSaving(false); }
  };
  return <Modal open onClose={onClose} title={editing ? "Ubah klien" : "Klien baru"} eyebrow={editing?.code}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nama legal (PT)" className="sm:col-span-2"><Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} data-autofocus /></Field>
      <Field label="Nama tampilan"><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
      <Field label="Industri"><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
      <Field label="NPWP"><Input value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} /></Field>
      <Field label="Telepon kontak"><Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
      <Field label="Nama kontak"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
      <Field label="Alamat" className="sm:col-span-2"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
    </div>
    {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    <Button className="mt-5 w-full" loading={saving} onClick={() => void save()}>{editing ? "Simpan perubahan" : "Buat klien"}</Button>
  </Modal>;
}

function SiteModal({ clients, editing, onClose, onDone }: {
  clients: { id: string; displayName: string }[];
  editing: { id: string; clientId: string; name: string; address: string | null; contact?: string } | null;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [form, setForm] = useState(() => (editing
    ? { clientId: editing.clientId, name: editing.name, address: editing.address ?? "", contact: editing.contact ?? "" }
    : { clientId: clients[0]?.id ?? "", name: "", address: "", contact: "" }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload = { clientId: form.clientId, name: form.name, address: form.address || null, contact: form.contact || null };
      if (editing) { await updateSiteRecord(editing.id, payload); onDone(`Site ${form.name} diperbarui.`); }
      else { await createSiteRecord(payload); onDone(`Site ${form.name} dibuat.`); }
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan site."); } finally { setSaving(false); }
  };
  return <Modal open onClose={onClose} title={editing ? "Ubah site" : "Site baru"}>
    <div className="grid gap-4">
      <Field label="Klien"><Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Pilih klien</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</Select></Field>
      <Field label="Nama site"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus /></Field>
      <Field label="Alamat"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      <Field label="Kontak site"><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
    </div>
    {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    <Button className="mt-5 w-full" loading={saving} onClick={() => void save()}>{editing ? "Simpan perubahan" : "Buat site"}</Button>
  </Modal>;
}

/* -------------------------------------------------------------------------- */
/* Tab anggota proyek                                                         */
/* -------------------------------------------------------------------------- */

function MembersTab({ data, canEdit, selected, onSelect, onSaved, onNeedOptions }: {
  data: AppData; canEdit: boolean; selected: string;
  onSelect: (id: string) => void; onSaved: (message: string) => void;
  onNeedOptions: () => Promise<MasterDataOptions>;
}) {
  const projectId = selected || data.projects[0]?.id || "";
  const [options, setOptions] = useState<MasterDataOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState({ userId: "", projectRole: "FIELD" });
  const [error, setError] = useState("");

  const rows: ProjectMemberView[] = useMemo(() => {
    const raw = data.members as Record<string, unknown>[];
    return raw.filter((m) => m.projectId === projectId).map((m) => ({
      id: String(m.id), projectId: String(m.projectId), userId: String(m.userId),
      projectRole: String(m.projectRole), name: String(m.userName ?? ""), email: String(m.email ?? ""),
      title: String(m.userRole ?? ""),
    }));
  }, [data.members, projectId]);

  const add = async () => {
    if (!projectId || !pick.userId) { setError("Pilih proyek dan pengguna."); return; }
    setLoading(true); setError("");
    try {
      await addProjectMember(projectId, pick);
      // `onSaved` memicu router.refresh() di parent, jadi `data.members` dimuat ulang.
      onSaved("Anggota proyek ditambahkan.");
      setPick({ userId: "", projectRole: pick.projectRole });
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menambah anggota."); } finally { setLoading(false); }
  };

  const remove = async (memberId: string) => {
    setLoading(true); setError("");
    try {
      await removeProjectMember(projectId, memberId);
      onSaved("Anggota proyek dikeluarkan.");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengeluarkan anggota."); } finally { setLoading(false); }
  };

  if (!data.projects.length) return <EmptyState icon={<Users size={18} />} title="Belum ada proyek" description="Buat proyek terlebih dahulu sebelum menugaskan anggota." />;
  const users = options?.users ?? [];
  const available = users.filter((u) => !rows.some((m) => m.userId === u.id));
  return <div className="space-y-4">
    <Field label="Proyek" className="max-w-md"><Select value={projectId} onChange={(e) => onSelect(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</Select></Field>
    {canEdit ? <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="mb-3 text-xs font-semibold">Tambah anggota</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_170px_auto]">
        <Field label="Pengguna"><Select value={pick.userId} onChange={(e) => setPick({ ...pick, userId: e.target.value })}><option value="">Pilih pengguna</option>{available.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</Select></Field>
        <Field label="Peran proyek"><Select value={pick.projectRole} onChange={(e) => setPick({ ...pick, projectRole: e.target.value })}>{(options?.projectRoles ?? ["PM", "FIELD"]).map((role) => <option key={role} value={role}>{LABELS[role] ?? role}</option>)}</Select></Field>
        <div className="flex items-end"><Button loading={loading} onClick={() => void add()}><UserRoundPlus size={15} />Tambah</Button></div>
      </div>
      {!options ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => void onNeedOptions().then(setOptions).catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat pengguna."))}>Muat daftar pengguna</Button> : null}
    </div> : null}
    {error ? <p className="rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-danger">{error}</p> : null}
    {rows.length ? <div className="space-y-2">{rows.map((m) => <div key={m.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface p-3">
      <div className="min-w-0"><p className="truncate text-xs font-semibold">{m.name || m.userId}</p><p className="text-[11px] text-muted">{LABELS[m.projectRole] ?? m.projectRole}{m.title ? ` · peran company ${LABELS[m.title] ?? m.title}` : ""}</p></div>
      {canEdit ? <Button size="sm" variant="ghost" className="text-danger" loading={loading} onClick={() => void remove(m.id)}><Trash2 size={13} />Keluarkan</Button> : null}
    </div>)}</div> : <EmptyState icon={<Users size={18} />} title="Belum ada anggota" description="Peran non-ADMIN harus menjadi anggota proyek untuk dapat membukanya." />}
  </div>;
}
