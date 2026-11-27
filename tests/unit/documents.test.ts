import { describe, expect, it } from "vitest";
import {
  buildDocxFromBlocks, extractDocxTags, isDocxBuffer, renderTemplateDocx, DocxTemplateError,
} from "@/lib/docx";
import { interpolateBlocks, unresolvedTags } from "@/modules/documents/service";
import {
  DEFAULT_TEMPLATE_VARIABLES, DOCX_MAX_BYTES, documentEditSchema, templateSchema,
} from "@/modules/documents/validation";
import { buildPhotoGalleryBlock, withPhotoRefs, type DocumentBlock } from "@/lib/document-templates";
import PizZip from "pizzip";

const blocks: DocumentBlock[] = [
  { type: "heading", level: 1, text: "BERITA ACARA" },
  { type: "keyValue", rows: [{ label: "Proyek", value: "PRJ-2026-001" }] },
  { type: "signature", parties: [{ label: "Untuk Klien", name: "Budi", title: "Direktur" }] },
];

describe("S4 · DOCX dari blok", () => {
  it("menghasilkan DOCX sah yang terbaca sebagai ZIP dengan document.xml", () => {
    const buffer = buildDocxFromBlocks(blocks, { title: "BAST 1", docNumber: "001/BAST1/EPC/XI/2026" });
    expect(isDocxBuffer(buffer)).toBe(true);
    const zip = new PizZip(buffer);
    expect(zip.file("word/document.xml")).toBeTruthy();
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/document.xml")!.asText()).toContain("001/BAST1/EPC/XI/2026");
  });

  it("meng-escape karakter XML agar dokumen tidak rusak", () => {
    const buffer = buildDocxFromBlocks(
      [{ type: "paragraph", text: "Harga < 10 & diskon > 5 \"khusus\"" }],
      { title: "Escaping" },
    );
    const xml = new PizZip(buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("&lt; 10 &amp; diskon");
    expect(xml).not.toContain("<w:t xml:space=\"preserve\">Harga <");
  });

  it("menolak buffer yang bukan DOCX", () => {
    expect(isDocxBuffer(Buffer.from("bukan zip"))).toBe(false);
    expect(isDocxBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(false);
  });
});

describe("S4 · template DOCX admin", () => {
  /* DOCX sah dibangun lewat builder blok agar [Content_Types].xml lengkap —
     docxtemplater menolak ZIP tanpa deklarasi paket. */
  const templateDocx = (text: string) => buildDocxFromBlocks([{ type: "paragraph", text }], { title: "template" });

  it("membaca tag {nama} dari document.xml", () => {
    const docx = templateDocx("Proyek {projectCode} untuk {clientLegalName}");
    expect(extractDocxTags(docx)).toEqual(["clientLegalName", "projectCode"]);
  });

  it("mengisi placeholder dan membiarkan nilai kosong", () => {
    const docx = templateDocx("{projectCode}");
    const rendered = renderTemplateDocx(docx, { projectCode: "PRJ-2026-001" });
    expect(new PizZip(rendered).file("word/document.xml")!.asText()).toContain("PRJ-2026-001");
  });

  it("variabel wajib yang kosong dilaporkan sebagai DocxTemplateError", () => {
    const docx = templateDocx("{projectCode}");
    try {
      renderTemplateDocx(docx, {}, { required: ["projectCode"] });
      throw new Error("seharusnya gagal");
    } catch (error) {
      expect(error).toBeInstanceOf(DocxTemplateError);
      expect((error as DocxTemplateError).missing).toEqual(["projectCode"]);
    }
  });
});

describe("S4 · interpolasi blok & tag belum terisi", () => {
  it("mengisi tag dari snapshot tanpa mengubah tipe blok", () => {
    const filled = interpolateBlocks([
      { type: "heading", level: 1, text: "BAST {projectCode}" },
      { type: "keyValue", rows: [{ label: "Klien", value: "{clientLegalName}" }] },
    ], { projectCode: "PRJ-1", clientLegalName: "PT Satu" });
    expect(filled[0]).toMatchObject({ type: "heading", text: "BAST PRJ-1" });
    expect(filled[1]).toMatchObject({ type: "keyValue", rows: [{ label: "Klien", value: "PT Satu" }] });
  });

  it("tag tak terdefinisi dibiarkan dan dilaporkan", () => {
    const subject: DocumentBlock[] = [{ type: "paragraph", text: "Nilai {contractValue} untuk {tidakAda}" }];
    const filled = interpolateBlocks(subject, { contractValue: "Rp 1.000" });
    expect(filled[0]).toMatchObject({ text: "Nilai Rp 1.000 untuk {tidakAda}" });
    expect(unresolvedTags(filled, { contractValue: "Rp 1.000" })).toEqual(["tidakAda"]);
  });

  it("galeri foto hanya muncul bila ada foto terpilih", () => {
    expect(buildPhotoGalleryBlock([])).toBeNull();
    const gallery = buildPhotoGalleryBlock([
      { id: "p1", fileId: "f1", category: "PROCESS", caption: "Pemasangan" },
    ]);
    expect(gallery).toMatchObject({ type: "photoGallery", heading: "LAMPIRAN FOTO LAPANGAN" });
    const merged = withPhotoRefs(blocks, [{ id: "p1", fileId: "f1", category: "PROCESS", caption: "Pemasangan" }]);
    expect(merged.some((block) => block.type === "photoGallery")).toBe(true);
  });
});

describe("S4 · validasi template", () => {
  const base = {
    code: "BAST1_CUSTOM", name: "BAST 1 Company", kind: "BLOCKS" as const,
    blocks: [{ type: "heading", level: 1, text: "BAST" }],
  };

  it("template blok wajib punya blok; template DOCX wajib punya berkas", () => {
    expect(() => templateSchema.parse({ ...base, blocks: [] })).toThrow();
    expect(() => templateSchema.parse({ ...base, kind: "DOCX" })).toThrow();
    expect(templateSchema.parse({ ...base, kind: "DOCX", docxFileId: "file-1" }).kind).toBe("DOCX");
    expect(templateSchema.parse({ ...base, code: "bast1_custom" }).code).toBe("BAST1_CUSTOM");
  });

  it("menolak tag variabel duplikat dan sumber yang tidak dikenal", () => {
    const variable = { tag: "projectCode", label: "Nomor proyek", source: "project.code", varType: "TEXT" as const, isRequired: true };
    expect(() => templateSchema.parse({ ...base, variables: [variable, variable] })).toThrow();
    expect(() => templateSchema.parse({ ...base, variables: [{ ...variable, source: "secret.env" }] })).toThrow();
    expect(templateSchema.parse({ ...base, variables: [variable] }).variables).toHaveLength(1);
  });

  it("batas unggah DOCX 10 MB dan 9 variabel default tersedia", () => {
    expect(DOCX_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DEFAULT_TEMPLATE_VARIABLES.map((v) => v.tag)).toContain("projectCode");
    expect(DEFAULT_TEMPLATE_VARIABLES.length).toBeGreaterThanOrEqual(9);
  });

  it("edit blok menolak daftar kosong", () => {
    expect(() => documentEditSchema.parse({ blocks: [] })).toThrow();
    expect(documentEditSchema.parse({ blocks: [{ type: "paragraph", text: "Isi" }] }).blocks).toHaveLength(1);
  });
});
