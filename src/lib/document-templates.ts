import { PHOTO_CATEGORY_ORDER } from "@/modules/field-photos/validation";

/** Kontrak merge minimal S3; generator penuh {{#...}} ditunda ke S4. */
export const PHOTO_MERGE_FIELD = "{{#photos}}";

export type DocumentPhotoRef = {
  id: string;
  fileId: string;
  category: string;
  caption: string;
  capturedAt?: string | null;
};

export type DocumentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "keyValue"; rows: { label: string; value: string }[] }
  | { type: "table"; columns: { key: string; label: string; format?: string }[]; rows: Record<string, string>[]; showTotals?: boolean }
  | { type: "signature"; parties: { label: string; name: string; title: string; date?: string }[] }
  | { type: "spacer"; height: number }
  | { type: "pageBreak" }
  | { type: "photoGallery"; heading?: string; photos: DocumentPhotoRef[] };

export function parsePhotoRows(raw?: string | null): DocumentPhotoRef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .filter((row) => typeof row.fileId === "string" && row.fileId.length > 0)
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        fileId: String(row.fileId),
        category: typeof row.category === "string" ? row.category : "PROCESS",
        caption: typeof row.caption === "string" ? row.caption : "Foto lapangan",
        capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : null,
      }));
  } catch {
    return [];
  }
}

export function buildPhotoGalleryBlock(refs: DocumentPhotoRef[]): DocumentBlock | null {
  if (!refs.length) return null;
  const photos = [...refs]
    .sort((a, b) => (PHOTO_CATEGORY_ORDER[a.category] ?? 99) - (PHOTO_CATEGORY_ORDER[b.category] ?? 99)
      || (a.capturedAt ?? "").localeCompare(b.capturedAt ?? ""))
    .slice(0, 12);
  return { type: "photoGallery", heading: "LAMPIRAN FOTO LAPANGAN", photos };
}

/** Finalisasi memakai link foto sebagai sumber, bukan URL presigned yang kedaluwarsa. */
export function withPhotoRefs(blocks: DocumentBlock[], refs: DocumentPhotoRef[]): DocumentBlock[] {
  const gallery = buildPhotoGalleryBlock(refs);
  const hasGallery = blocks.some((block) => block.type === "photoGallery");
  if (!gallery) return blocks.filter((block) => block.type !== "photoGallery");
  const replaced = blocks.map((block) => block.type === "photoGallery" ? gallery : block);
  if (hasGallery) return replaced;
  const signatureIndex = replaced.findIndex((block) => block.type === "signature");
  const at = signatureIndex < 0 ? replaced.length : signatureIndex;
  return [...replaced.slice(0, at), { type: "pageBreak" }, gallery, ...replaced.slice(at)];
}

export const DOCUMENT_TEMPLATES = [
  { code: "PROPOSAL_SPH", name: "Surat Penawaran Harga", description: "Surat resmi lingkup, harga, validitas, dan tanda tangan." },
  { code: "RAB_CLIENT", name: "RAB Penawaran", description: "Rincian pos pekerjaan dan harga klien; tanpa biaya internal." },
  { code: "BA_SURVEY", name: "BA Survei", description: "Peserta, temuan site, risiko, dan asumsi teknis." },
  { code: "BA_MOS", name: "BA Material On Site", description: "Berita acara material utama tiba dan diperiksa di site." },
  { code: "BA_COMMISSIONING", name: "BA Uji / Commissioning", description: "Parameter uji beban, hasil, dan persetujuan para pihak." },
  { code: "BAST1", name: "BAST 1", description: "Serah terima pekerjaan dan awal masa pemeliharaan." },
  { code: "BAST2", name: "BAST 2", description: "Serah terima akhir setelah masa pemeliharaan dan retensi." },
  { code: "INVOICE", name: "Invoice", description: "Tagihan DPP, PPN, total, jatuh tempo, dan terbilang." },
  { code: "KWITANSI", name: "Kwitansi", description: "Bukti penerimaan pembayaran dengan potongan pajak." },
  { code: "PROGRESS_REPORT", name: "Laporan Progres Mingguan", description: "Progres terbobot, capaian aktivitas, kendala, dan rencana." },
  { code: "CHANGE_ORDER", name: "Change Order / Addendum", description: "Perubahan lingkup, dampak harga, biaya, dan waktu." },
] as const;

export function buildBlocks(templateCode: string, snapshot: Record<string, string>): DocumentBlock[] {
  const projectRows = [
    { label: "Nomor proyek", value: snapshot.projectCode || "[belum diisi: project.code]" },
    { label: "Pekerjaan", value: snapshot.projectTitle || "[belum diisi: project.title]" },
    { label: "Klien", value: snapshot.clientLegalName || "[belum diisi: client.legalName]" },
    { label: "Lokasi", value: snapshot.siteName || "[belum diisi: site.name]" },
    { label: "Kontrak", value: snapshot.contractNumber || "[belum diisi: contract.number]" },
  ];
  const photoBlocks: DocumentBlock[] = (() => {
    const gallery = buildPhotoGalleryBlock(parsePhotoRows(snapshot[PHOTO_MERGE_FIELD] ?? snapshot.photoRows));
    return gallery ? [gallery] : [];
  })();
  const signature: DocumentBlock = { type: "signature", parties: [{ label: "Untuk Klien", name: snapshot.clientContact || "(____________________)", title: snapshot.clientLegalName || "Klien" }, { label: "Untuk Kontraktor", name: snapshot.pmName || "(____________________)", title: snapshot.companyLegalName || "Kontraktor EPC", date: snapshot.documentDate }] };
  if (templateCode === "INVOICE" || templateCode === "KWITANSI") return [
    { type: "heading", level: 1, text: templateCode === "INVOICE" ? "INVOICE" : "KWITANSI PEMBAYARAN" },
    { type: "keyValue", rows: [{ label: "Nomor invoice", value: snapshot.invoiceNumber || "—" }, { label: "Tanggal / jatuh tempo", value: `${snapshot.invoiceIssueDate || "—"} / ${snapshot.invoiceDueDate || "—"}` }, ...projectRows] },
    { type: "table", columns: [{ key: "description", label: "Uraian" }, { key: "amount", label: "Jumlah" }], rows: [{ description: `${snapshot.invoiceType || "Termin"} — ${snapshot.projectTitle || "Pekerjaan EPC"}`, amount: snapshot.invoiceDpp || "Rp 0" }, { description: "PPN", amount: snapshot.invoicePpn || "Rp 0" }, { description: "Total tagihan", amount: snapshot.invoiceTotal || "Rp 0" }] },
    { type: "paragraph", text: `Terbilang: ${snapshot.invoiceTotalInWords || "[belum diisi: invoice.totalInWords]"}` }, signature,
  ];
  if (templateCode === "PROGRESS_REPORT") return [
    { type: "heading", level: 1, text: "LAPORAN PROGRES MINGGUAN" }, { type: "keyValue", rows: [...projectRows, { label: "Tanggal laporan", value: snapshot.documentDate || "—" }, { label: "Progres fisik terbobot", value: `${snapshot.progressPct || "0"}%` }] },
    { type: "table", columns: [{ key: "activity", label: "Aktivitas" }, { key: "plan", label: "Rencana selesai" }, { key: "progress", label: "Progres" }, { key: "status", label: "Status" }], rows: JSON.parse(snapshot.scheduleRows || "[]") as Record<string, string>[] },
    { type: "paragraph", text: "Catatan lapangan dan isu yang memerlukan keputusan dirangkum pada tabel di atas. Tindak lanjut dipantau melalui update progres berikutnya." }, ...photoBlocks, signature,
  ];
  if (templateCode === "CHANGE_ORDER") return [
    { type: "heading", level: 1, text: "CHANGE ORDER / ADDENDUM" }, { type: "keyValue", rows: [...projectRows, { label: "Referensi", value: snapshot.changeOrderCode || "—" }, { label: "Perubahan harga (DPP)", value: snapshot.priceImpact || "Rp 0" }, { label: "Tambahan waktu", value: `${snapshot.timeImpactDays || "0"} hari kalender` }] },
    { type: "paragraph", text: snapshot.scopeDescription || "Lingkup perubahan belum diisi." }, { type: "paragraph", text: `Alasan perubahan: ${snapshot.reason || "—"}` }, ...photoBlocks, signature,
  ];
  if (templateCode === "RAB_CLIENT") return [
    { type: "heading", level: 1, text: "RENCANA ANGGARAN BIAYA — PENAWARAN" }, { type: "keyValue", rows: projectRows },
    { type: "table", columns: [{ key: "code", label: "Kode" }, { key: "description", label: "Uraian pekerjaan" }, { key: "quantity", label: "Volume" }, { key: "amount", label: "Jumlah" }], rows: JSON.parse(snapshot.budgetRows || "[]") as Record<string, string>[] },
    { type: "paragraph", text: `Total DPP: ${snapshot.contractValue || "Rp 0"}. Harga belum termasuk PPN kecuali dinyatakan lain.` }, signature,
  ];
  const titles: Record<string, string> = { PROPOSAL_SPH: "SURAT PENAWARAN HARGA", BA_SURVEY: "BERITA ACARA SURVEI", BA_MOS: "BERITA ACARA MATERIAL ON SITE", BA_COMMISSIONING: "BERITA ACARA TESTING & COMMISSIONING", BAST1: "BERITA ACARA SERAH TERIMA PEKERJAAN (BAST 1)", BAST2: "BERITA ACARA SERAH TERIMA AKHIR (BAST 2)" };
  return [
    { type: "heading", level: 1, text: titles[templateCode] || "DOKUMEN PROYEK" }, { type: "keyValue", rows: [...projectRows, { label: "Tanggal dokumen", value: snapshot.documentDate || "—" }, { label: "Nilai kontrak (DPP)", value: snapshot.contractValue || "—" }] },
    { type: "paragraph", text: templateCode === "BAST1" ? "Para pihak menyatakan bahwa pekerjaan telah selesai diperiksa dan diserahterimakan. Masa pemeliharaan berlaku sejak tanggal dokumen ini sesuai kontrak." : templateCode === "BAST2" ? "Masa pemeliharaan telah berakhir dan kewajiban para pihak telah diverifikasi. Dokumen ini menjadi dasar penyelesaian retensi dan penutupan proyek." : templateCode === "BA_COMMISSIONING" ? "Pengujian insulation, grounding, fungsi ATS/AMF, dan uji beban dilaksanakan sesuai prosedur yang disetujui. Hasil pengukuran dan catatan punch list terlampir." : "Berdasarkan pemeriksaan bersama di lokasi, para pihak mencatat kondisi, lingkup, dan hasil pekerjaan sebagaimana terlampir dalam dokumen ini." },
    { type: "paragraph", text: "Dokumen ini dibuat dari snapshot data proyek. Setiap revisi diterbitkan sebagai record baru tanpa mengubah dokumen final sebelumnya." }, ...photoBlocks, signature,
  ];
}
