"use client";

import { useMemo, useState } from "react";
import { Camera, Check, ImageIcon, Upload } from "lucide-react";
import type { AppData, FieldPhotoView, ProjectView } from "@/components/types";
import {
  Badge, Button, EmptyState, Field, Input, Modal, SectionTitle, Select, Textarea,
} from "@/components/ui";
import { api, uploadFieldPhoto } from "@/lib/client";
import { LABELS } from "@/lib/domain";
import { formatDate, todayJakarta } from "@/lib/format";
import { filterFieldPhotos } from "@/modules/field-photos/filter";
import { MAX_PHOTO_BYTES, PHOTO_CATEGORIES, type PhotoCategory } from "@/modules/field-photos/validation";

type Notify = (message: string) => void;
type Props = { data: AppData; project: ProjectView; onSaved: Notify };

export default function FieldPhotosPanel({ data, project, onSaved }: Props) {
  const canUpload = data.user.permissions.includes("document.upload");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState<PhotoCategory | "">("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | undefined>();
  const [form, setForm] = useState({
    category: "BEFORE" as PhotoCategory,
    capturedAt: todayJakarta(),
    description: "",
    locationLabel: "",
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const projectPhotos = useMemo(
    () => data.fieldPhotos.filter((photo) => photo.projectId === project.id),
    [data.fieldPhotos, project.id],
  );
  const visible = useMemo(() => filterFieldPhotos(projectPhotos, {
    projectId: project.id, from, to, category: category || undefined, selectedOnly,
  }), [projectPhotos, project.id, from, to, category, selectedOnly]);
  const selectedCount = projectPhotos.filter((photo) => photo.isSelectedForReport).length;

  const upload = async () => {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      if (file.size > MAX_PHOTO_BYTES) throw new Error("Ukuran foto maksimal 5 MB.");
      await uploadFieldPhoto(file, { ...form, projectId: project.id });
      onSaved("Foto lapangan tersimpan. Metadata ada di DB; bytes ada di storage.");
      setOpen(false);
      setFile(undefined);
      setForm({ category: "BEFORE", capturedAt: todayJakarta(), description: "", locationLabel: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unggahan foto gagal.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = async (photo: FieldPhotoView) => {
    setBusyId(photo.id);
    setError("");
    try {
      await api(`/api/field-photos/${photo.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: photo.isSelectedForReport ? "UNSELECT" : "SELECT" }),
      });
      onSaved(photo.isSelectedForReport ? "Foto dikeluarkan dari lampiran laporan." : "Foto ditandai masuk lampiran laporan.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah pilihan foto.");
    } finally {
      setBusyId("");
    }
  };

  return <div>
    <SectionTitle
      eyebrow="S3 · dokumentasi lapangan"
      title="Foto Lapangan"
      description="Unggah before / process / after, filter berdasarkan tanggal, lalu pilih foto yang tampil pada PDF laporan progres atau berita acara."
      action={canUpload ? <Button variant="lime" onClick={() => setOpen(true)}><Upload size={15} />Unggah foto</Button> : null}
    />
    <div className="mb-4 grid gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
      <Field label="Dari tanggal"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="Sampai tanggal"><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Kategori"><Select value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory | "")}><option value="">Semua</option>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{LABELS[c]}</option>)}</Select></Field>
      <label className="flex items-end gap-2 pb-2 text-[11.5px] font-medium text-muted"><input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} className="h-4 w-4" />Hanya masuk laporan</label>
    </div>
    <p className="mb-3 text-[11.5px] text-muted">
      Menampilkan <strong className="text-ink">{visible.length}</strong> dari {projectPhotos.length} foto · {selectedCount} dipilih untuk laporan.
      {data.user.role === "CLIENT_VIEWER" ? " Akun klien hanya melihat foto yang sudah diproyeksikan ke laporan." : ""}
    </p>
    {error ? <p className="mb-3 rounded-[var(--radius-control)] bg-warn-bg p-3 text-xs text-danger">{error}</p> : null}
    {!visible.length ? <EmptyState icon={<Camera />} title="Tidak ada foto pada filter ini" description="Ubah rentang tanggal atau unggah foto lapangan baru. Maksimal 5 MB per file." /> : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((photo) => <article key={photo.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="relative aspect-[4/3] bg-paper-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL presigned 5 menit dari storage privat */}
            <img src={photo.fileUrl} alt={`${LABELS[photo.category]} — ${photo.description || "Foto lapangan"}`} loading="lazy" className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 rounded-[var(--radius-pill)] bg-ink/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-lime">{LABELS[photo.category] || photo.category}</span>
            {photo.isSelectedForReport ? <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-lime px-2 py-1 text-[10px] font-bold text-ink"><Check size={11} />Laporan</span> : null}
          </div>
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-subtle"><span className="mono">{formatDate(photo.capturedAt)}</span><Badge value={photo.isSelectedForReport ? "ACTIVE" : "DRAFT"} label={photo.isSelectedForReport ? "Terpilih" : "Arsip"} /></div>
            <p className="line-clamp-2 text-[11.5px] font-semibold leading-relaxed text-ink">{photo.description || photo.locationLabel || "Foto lapangan"}</p>
            {photo.locationLabel ? <p className="truncate text-[10.5px] text-muted">{photo.locationLabel}</p> : null}
            <p className="text-[10px] text-subtle">{photo.uploadedByName} · {(photo.sizeBytes / 1024).toFixed(0)} KB</p>
            {canUpload ? <Button size="sm" variant={photo.isSelectedForReport ? "secondary" : "lime"} className="w-full" loading={busyId === photo.id} onClick={() => void toggleSelection(photo)}>{photo.isSelectedForReport ? "Keluarkan dari laporan" : "Masuk laporan"}</Button> : null}
          </div>
        </article>)}
      </div>
    )}
    <Modal open={open} onClose={() => setOpen(false)} title="Unggah foto lapangan" eyebrow={project.code}>
      <div className="space-y-4">
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line bg-paper p-4 text-center">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0])} />
          <ImageIcon size={20} className="text-muted" />
          <span className="mt-2 text-xs font-semibold">{file ? file.name : "Pilih JPG, PNG, atau WebP (maks. 5 MB)"}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kategori"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as PhotoCategory })}>{PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{LABELS[c]}</option>)}</Select></Field>
          <Field label="Tanggal foto"><Input type="date" value={form.capturedAt} onChange={(e) => setForm({ ...form, capturedAt: e.target.value })} /></Field>
        </div>
        <Field label="Lokasi / titik pekerjaan" hint="Opsional, tampil sebagai caption PDF"><Input value={form.locationLabel} onChange={(e) => setForm({ ...form, locationLabel: e.target.value })} placeholder="Area panel LV / Grid A-3" /></Field>
        <Field label="Keterangan" hint="Maksimal 300 karakter"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <Button className="w-full" loading={saving} disabled={!file || !form.capturedAt} onClick={() => void upload()}><Upload size={15} />Simpan foto</Button>
      </div>
    </Modal>
  </div>;
}
