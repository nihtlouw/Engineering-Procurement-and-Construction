import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { DocumentBlock } from "@/lib/document-templates";

const SYMBOLS: Record<string, string> = {
  "×": "x", "—": "-", "–": "-", "‘": "'", "’": "'",
  "“": '"', "”": '"', "…": "...", " ": " ", "→": "->",
};

/** Keep printable latin text intact; only replace characters the PDF font cannot draw. */
function sanitize(value: string) {
  return value
    .replace(/[\u00d7\u2014\u2013\u2018\u2019\u201c\u201d\u2026\u00a0\u2192]/g, (c) => SYMBOLS[c] ?? c)
    .replace(/[\r\n\t]+/g, " ");
}

export async function renderDocumentPdf(
  title: string,
  docNumber: string,
  blocks: DocumentBlock[],
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const ensure = (height = 50) => {
    if (y - height < 55) {
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
    }
  };
  const BODY = rgb(0.12, 0.15, 0.13);
  const MUTED = rgb(0.42, 0.45, 0.43);
  const draw = (value: string, x: number, size: number, isBold = false, color = BODY) => {
    if (!value) return;
    page.drawText(sanitize(value), { x, y, size, font: isBold ? bold : font, color });
  };
  /** Wrap text to a max width in points; returns the number of lines drawn. */
  const wrap = (value: string, x: number, size: number, maxWidth: number, isBold = false, color = BODY, lineHeight = size * 1.45) => {
    const effective = isBold ? bold : font;
    const words = sanitize(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (effective.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const entry of lines) {
      ensure(lineHeight + 4);
      page.drawText(entry, { x, y, size, font: effective, color });
      y -= lineHeight;
    }
    return lines.length;
  };
  const header = () => {
    ensure(90);
    draw("PT ARDAYA ENERGI SISTEM", 48, 10, true);
    y -= 18;
    draw(docNumber, 48, 8, false, MUTED);
    y -= 32;
  };
  header();
  const CONTENT_WIDTH = 499;
  for (const block of blocks) {
    if (block.type === "pageBreak") {
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
      header();
      continue;
    }
    if (block.type === "spacer") {
      y -= Math.min(block.height, 100);
      continue;
    }
    if (block.type === "heading") {
      const size = block.level === 1 ? 15 : 12;
      y -= 6;
      wrap(block.text, 48, size, CONTENT_WIDTH, true, BODY, size * 1.5);
      y -= 8;
    }
    if (block.type === "paragraph") {
      wrap(block.text, 48, 9.5, CONTENT_WIDTH, false, BODY, 14);
      y -= 8;
    }
    if (block.type === "keyValue") {
      for (const row of block.rows) {
        const labelHeight = Math.max(1, Math.ceil(font.widthOfTextAtSize(sanitize(row.label), 9) / 145));
        ensure(18 * labelHeight + 2);
        const startY = y;
        page.drawText(sanitize(row.label), { x: 48, y: startY, size: 9, font: bold, color: MUTED });
        wrap(row.value || "-", 205, 9.5, CONTENT_WIDTH - 157, true, BODY, 12.5);
        if (y > startY - 18) y = startY - 18;
      }
      y -= 8;
    }
    if (block.type === "table") {
      const columns = block.columns;
      const colWidth = CONTENT_WIDTH / columns.length;
      ensure(26);
      columns.forEach((c, i) => {
        page.drawRectangle({ x: 48 + i * colWidth, y: y - 4, width: colWidth, height: 16, color: rgb(0.95, 0.96, 0.94) });
        page.drawText(sanitize(c.label), { x: 51 + i * colWidth, y, size: 8, font: bold, color: BODY });
      });
      y -= 20;
      for (const row of block.rows) {
        const cells = columns.map((c) => sanitize(row[c.key] || "-"));
        const heights = cells.map((value, i) => {
          const words = value.split(/\s+/);
          let lines = 1, line = "";
          for (const w of words) {
            const candidate = line ? `${line} ${w}` : w;
            if (font.widthOfTextAtSize(candidate, 8) > colWidth - 6 && line) { lines += 1; line = w; } else line = candidate;
          }
          return lines;
        });
        const rowHeight = Math.max(...heights) * 10.5 + 5;
        ensure(rowHeight + 6);
        const rowTop = y;
        cells.forEach((value, i) => {
          const x = 51 + i * colWidth;
          const words = value.split(/\s+/);
          const lines: string[] = [];
          let line = "";
          for (const w of words) {
            const candidate = line ? `${line} ${w}` : w;
            if (font.widthOfTextAtSize(candidate, 8) > colWidth - 6 && line) { lines.push(line); line = w; } else line = candidate;
          }
          if (line) lines.push(line);
          lines.forEach((entry, li) => page.drawText(entry, { x, y: rowTop - li * 10.5, size: 8, font, color: BODY }));
        });
        y = rowTop - rowHeight;
        page.drawLine({ start: { x: 48, y: y + 4 }, end: { x: 48 + CONTENT_WIDTH, y: y + 4 }, thickness: 0.4, color: rgb(0.88, 0.9, 0.87) });
      }
      y -= 12;
    }
    if (block.type === "signature") {
      ensure(130);
      const width = CONTENT_WIDTH / block.parties.length;
      block.parties.forEach((p, i) => {
        draw(p.label, 48 + i * width, 9, true, MUTED);
      });
      y -= 54;
      block.parties.forEach((p, i) => draw("(____________________)", 48 + i * width, 9));
      y -= 16;
      block.parties.forEach((p, i) => wrap(p.name, 48 + i * width, 9, width - 12, true, BODY, 11));
      block.parties.forEach((p, i) => wrap(p.title, 48 + i * width, 8, width - 12, false, MUTED, 10));
      y -= 18;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(
      `Hal ${i + 1} dari ${pages.length} - Dokumen final tersimpan sebagai snapshot`,
      { x: 48, y: 30, size: 7, font, color: rgb(0.45, 0.47, 0.46) },
    ),
  );
  // margin note that the document was rendered from an immutable snapshot
  void title;
  return Buffer.from(await pdf.save());
}
