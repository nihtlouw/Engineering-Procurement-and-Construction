import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { DocumentBlock } from "@/lib/document-templates";

export async function renderDocumentPdf(title: string, docNumber: string, blocks: DocumentBlock[]) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595.28, 841.89]); let y = 790;
  const ensure = (height = 50) => { if (y - height < 55) { page = pdf.addPage([595.28, 841.89]); y = 790; } };
  const text = (value: string, x: number, size = 9, isBold = false) => { const clean = value.replace(/[^\x20-\x7E]/g, "-").slice(0, 110); page.drawText(clean, { x, y, size, font: isBold ? bold : font, color: rgb(0.12, 0.15, 0.13) }); };
  const header = () => { ensure(90); text("PT ARDAYA ENERGI SISTEM", 48, 10, true); y -= 18; text(docNumber, 48, 8); y -= 32; };
  header();
  for (const block of blocks) {
    if (block.type === "pageBreak") { page = pdf.addPage([595.28, 841.89]); y = 790; header(); continue; }
    if (block.type === "spacer") { y -= Math.min(block.height, 100); continue; }
    if (block.type === "heading") { ensure(45); text(block.text, 48, block.level === 1 ? 15 : 12, true); y -= 30; }
    if (block.type === "paragraph") { const words = block.text.split(/\s+/); let line = ""; for (const word of words) { if ((line + word).length > 92) { ensure(18); text(line, 48); y -= 15; line = ""; } line += `${word} `; } if (line) { ensure(18); text(line, 48); y -= 22; } }
    if (block.type === "keyValue") { for (const row of block.rows) { ensure(20); text(row.label, 48, 9, true); text(row.value, 205); y -= 18; } y -= 12; }
    if (block.type === "table") { ensure(30); block.columns.forEach((c, i) => text(c.label, 48 + i * (495 / block.columns.length), 8, true)); y -= 18; for (const row of block.rows) { ensure(20); block.columns.forEach((c, i) => text(row[c.key] || "—", 48 + i * (495 / block.columns.length), 8)); y -= 17; } y -= 15; }
    if (block.type === "signature") { ensure(130); const width = 495 / block.parties.length; block.parties.forEach((p, i) => { text(p.label, 48 + i * width, 9, true); text("(____________________)", 48 + i * width, 9); }); y -= 70; block.parties.forEach((p, i) => { text(p.name, 48 + i * width, 9, true); }); y -= 18; block.parties.forEach((p, i) => text(p.title, 48 + i * width, 8)); y -= 25; }
  }
  const pages = pdf.getPages(); pages.forEach((p, i) => p.drawText(`Hal ${i + 1} dari ${pages.length} - Dokumen final tersimpan sebagai snapshot`, { x: 48, y: 30, size: 7, font, color: rgb(0.45, 0.47, 0.46) }));
  return Buffer.from(await pdf.save());
}
