import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { DocumentBlock } from "@/lib/document-templates";

/**
 * DOCX murni JavaScript (tanpa LibreOffice/Chromium) supaya kompatibel dengan
 * fungsi serverless Vercel. Dua arah:
 *  - `renderTemplateDocx`: isi placeholder `{tag}` dari snapshot.
 *  - `buildDocxFromBlocks`: bangun DOCX dari blok dokumen (fallback ketika
 *    template belum punya berkas DOCX milik admin).
 */

/** DOCX = ZIP; signature `PK\x03\x04`. Ekstensi saja tidak cukup. */
export function isDocxBuffer(buffer: Buffer): boolean {
  return buffer.length > 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
    && buffer.includes(Buffer.from("[Content_Types].xml"));
}

const escapeXml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Placeholder yang dipakai template DOCX admin: `{projectCode}`. */
export function extractDocxTags(docx: Buffer): string[] {
  const zip = new PizZip(docx);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  const tags = new Set<string>();
  for (const match of xml.matchAll(/\{([#/]?)([a-zA-Z0-9_.]+)\}/g)) {
    if (match[1]) continue; // bagian loop `{#rows}` / penutup `{/rows}` bukan tag skalar
    tags.add(match[2]);
  }
  return [...tags].sort();
}

export class DocxTemplateError extends Error {
  constructor(message: string, readonly missing: string[] = []) {
    super(message);
    this.name = "DocxTemplateError";
  }
}

/**
 * Isi template DOCX. Nilai yang tidak ada dibiarkan kosong — kecuali `required`
 * (variabel wajib template) yang dilaporkan sebagai error 422 oleh service.
 */
export function renderTemplateDocx(
  docx: Buffer,
  data: Record<string, unknown>,
  options: { required?: string[] } = {},
): Buffer {
  const zip = new PizZip(docx);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  const missing = (options.required ?? []).filter((tag) => {
    const value = data[tag];
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    throw new DocxTemplateError(`Variabel template belum memiliki nilai: ${missing.join(", ")}.`, missing);
  }
  try {
    doc.render(data);
  } catch (error) {
    // Error sintaks template (mis. tag tidak ditutup) harus menjadi 422, bukan 500.
    throw new DocxTemplateError(
      `Template DOCX tidak dapat dirender: ${error instanceof Error ? error.message : "struktur tidak valid"}.`,
    );
  }
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

const W = 9360; // lebar teks A4 (twips) dengan margin default

const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) => {
  const props = [
    opts.bold ? "<w:b/>" : "",
    opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : "",
    opts.color ? `<w:color w:val="${opts.color}"/>` : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
};

const para = (text: string, opts: { bold?: boolean; size?: number; align?: "left" | "center" | "right"; color?: string; spaceAfter?: number } = {}) =>
  `<w:p><w:pPr>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ""}${opts.spaceAfter !== undefined ? `<w:spacing w:after="${opts.spaceAfter}"/>` : ""}</w:pPr>${run(text, opts)}</w:p>`;

const cell = (text: string, opts: { bold?: boolean; width?: number } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${opts.width ?? Math.floor(W / 4)}" w:type="dxa"/>${opts.bold ? "" : ""}</w:tcPr>${para(text, { bold: opts.bold, size: 18 })}</w:tc>`;

const table = (columns: { key: string; label: string }[], rows: Record<string, string>[]) => {
  const width = Math.floor(W / Math.max(1, columns.length));
  const header = `<w:tr>${columns.map((c) => cell(c.label, { bold: true, width })).join("")}</w:tr>`;
  const body = rows.map((row) => `<w:tr>${columns.map((c) => cell(row[c.key] ?? "—", { width })).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders></w:tblPr>${header}${body}</w:tbl>`;
};

/** DOCX dari blok dokumen — dipakai bila template tidak mengunggah berkas DOCX. */
export function buildDocxFromBlocks(blocks: DocumentBlock[], meta: { title: string; docNumber?: string | null }): Buffer {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      parts.push(para(block.text, { bold: true, size: block.level === 1 ? 32 : block.level === 2 ? 26 : 22, align: "center", spaceAfter: 240 }));
    } else if (block.type === "paragraph") {
      parts.push(para(block.text, { size: 20, spaceAfter: 160 }));
    } else if (block.type === "keyValue") {
      parts.push(table([{ key: "label", label: "Uraian" }, { key: "value", label: "Nilai" }],
        block.rows.map((row) => ({ label: row.label, value: row.value }))));
    } else if (block.type === "table") {
      parts.push(table(block.columns, block.rows));
    } else if (block.type === "signature") {
      parts.push(table([{ key: "label", label: "Pihak" }, { key: "name", label: "Nama" }, { key: "title", label: "Jabatan" }],
        block.parties.map((party) => ({ label: party.label, name: party.name, title: party.title }))));
    } else if (block.type === "photoGallery") {
      parts.push(para(block.heading || "LAMPIRAN FOTO LAPANGAN", { bold: true, size: 22, align: "center" }));
      for (const photo of block.photos) {
        parts.push(para(`${photo.category} — ${photo.caption} (lihat lampiran PDF untuk gambar)`, { size: 18 }));
      }
    } else if (block.type === "pageBreak") {
      parts.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
    } else if (block.type === "spacer") {
      parts.push(para("", { spaceAfter: block.height * 10 }));
    }
  }

  const body = `<w:body>
${para("PT ARDAYA ENERGI SISTEM", { bold: true, size: 18 })}
${meta.docNumber ? para(meta.docNumber, { size: 16, color: "6B7280" }) : ""}
${parts.join("\n")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
