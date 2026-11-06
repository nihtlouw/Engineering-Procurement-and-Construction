#!/usr/bin/env node
/**
 * Pembuat PDF dokumentasi Ardaya EPC.
 *
 * Sumber isi: objek CONTENT di bawah (struktur blok, bukan HTML), sehingga tata letak PDF
 * sepenuhnya dikendalikan skrip ini dan tidak bergantung mesin render browser.
 * Font: Instrument Sans (dikonversi dari woff2 ke ttf saat build) + DejaVu Sans sebagai cadangan.
 *
 * Jalankan: node tools/build-docs-pdf.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import wawoff2 from "wawoff2";
import { CONTENT } from "./docs-content.mjs";

const OUT_DIR = "public/docs";
const OUT_FILE = `${OUT_DIR}/Panduan-Ardaya-EPC.pdf`;
const A4 = [595.28, 841.89];
const M = { top: 64, right: 54, bottom: 62, left: 54 };
const INK = rgb(0.074, 0.109, 0.09);
const MUTED = rgb(0.322, 0.361, 0.333);
const SUBTLE = rgb(0.416, 0.459, 0.431);
const LINE = rgb(0.891, 0.898, 0.871);
const PAPER = rgb(0.965, 0.965, 0.949);
const SUNKEN = rgb(0.98, 0.98, 0.965);
const LIME = rgb(0.776, 0.949, 0.306);
const DANGER = rgb(0.635, 0.149, 0.11);
const OK = rgb(0.09, 0.376, 0.235);
const RULE = rgb(0.812, 0.827, 0.788);

/* ---------- Font ---------- */
const TTF = { regular: "/tmp/InstrumentSans-Regular.ttf", bold: "/tmp/InstrumentSans-SemiBold.ttf" };

async function ttfFromWoff2(path) {
  const woff = readFileSync(path);
  const out = await wawoff2.decompress(woff);
  return new Uint8Array(out);
}

async function loadFonts(pdf) {
  pdf.registerFontkit(fontkit);
  try {
    const regular = await ttfFromWoff2("node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2");
    const semibold = await ttfFromWoff2("node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2");
    writeFileSync(TTF.regular, regular); writeFileSync(TTF.bold, semibold);
    return {
      regular: await pdf.embedFont(regular, { subset: true }),
      bold: await pdf.embedFont(semibold, { subset: true }),
      standard: false,
    };
  } catch (error) {
    console.warn("Font Instrument Sans gagal dimuat, memakai Helvetica:", error.message);
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      standard: true,
    };
  }
}

/* Pengaman encoding: font subset hanya mendukung glyph latin; penggantian simbol dilakukan lebih dulu */
function clean(text) {
  return String(text)
    .replace(/\u2014/g, "-").replace(/\u2013/g, "-")
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2022/g, "-").replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\u2192/g, "->").replace(/\u2264/g, "<=").replace(/\u2265/g, ">=")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "");
}

/* ---------- Dokumen ---------- */
class Doc {
  constructor(pdf, fonts) {
    this.pdf = pdf; this.f = fonts;
    this.page = null; this.y = 0; this.pageNo = 0;
    this.pages = [];
    this.headingStack = [];
    this.toc = [];
  }

  newPage() {
    this.page = this.pdf.addPage(A4);
    this.pageNo += 1;
    this.pages.push(this.page);
    this.y = A4[1] - M.top;
    return this.page;
  }

  ensure(height) {
    if (!this.page || this.y - height < M.bottom) this.newPage();
  }

  /* Teks mentah dengan pemetaan simbol WinAnsi */
  static sanitize(text) { return clean(text); }

  width(text, size, bold = false) {
    const font = bold ? this.f.bold : this.f.regular;
    return font.widthOfTextAtSize(Doc.sanitize(text), size);
  }

  wrap(text, size, maxWidth, bold = false) {
    const font = bold ? this.f.bold : this.f.regular;
    const words = Doc.sanitize(text).split(/\s+/).filter(Boolean);
    const lines = []; let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  text(str, { size = 9.5, bold = false, color = INK, x = M.left, gap = 3, leading = 1.45, maxWidth, align = "left" } = {}) {
    const width = maxWidth ?? A4[0] - M.left - M.right;
    const lines = this.wrap(str, size, width, bold);
    const lineHeight = size * leading;
    // cegah baris yatim: bila sisa ruang hanya cukup untuk 1-2 baris, pindah halaman
    const fits = this.page ? Math.floor((this.y - M.bottom) / lineHeight) : lines.length;
    if (lines.length > 1 && fits < lines.length && (fits <= 1 || lines.length - fits < 2)) this.newPage();
    for (const line of lines) {
      this.ensure(lineHeight);
      const w = this.width(line, size, bold);
      const drawX = align === "right" ? x + width - w : align === "center" ? x + (width - w) / 2 : x;
      this.page.drawText(line, { x: drawX, y: this.y - size, size, font: bold ? this.f.bold : this.f.regular, color });
      this.y -= lineHeight;
    }
    this.y -= gap;
    return this;
  }

  rule(color = LINE, width = 0.7) {
    this.ensure(8);
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: A4[0] - M.right, y: this.y }, thickness: width, color });
    this.y -= 10;
  }

  gap(space = 8) { this.y -= space; }

  /* Judul bab (H1) dengan garis aksen */
  h1(num, title, kicker) {
    if (this.page && this.y < A4[1] - M.top - 20) this.newPage();
    else if (!this.page) this.newPage();
    this.toc.push({ num, title, page: this.pageNo });
    if (kicker) {
      this.page.drawText(Doc.sanitize(kicker.toUpperCase()), { x: M.left, y: this.y - 8, size: 7.5, font: this.f.bold, color: MUTED });
      this.y -= 20;
    }
    this.page.drawText(Doc.sanitize(num), { x: M.left, y: this.y - 20, size: 16, font: this.f.bold, color: SUBTLE });
    const lines = this.wrap(title, 17, A4[0] - M.left - M.right - 40, true);
    let offset = 0;
    for (const line of lines) {
      this.page.drawText(line, { x: M.left + 34, y: this.y - 20 - offset, size: 17, font: this.f.bold, color: INK });
      offset += 21;
    }
    this.y -= 30 + (lines.length - 1) * 21;
    this.page.drawRectangle({ x: M.left, y: this.y + 2, width: 46, height: 2.5, color: LIME });
    this.y -= 16;
  }

  h2(title) {
    this.ensure(26 + 42);
    this.y -= 4;
    this.page.drawText(Doc.sanitize(title), { x: M.left, y: this.y - 11, size: 11.5, font: this.f.bold, color: INK });
    this.y -= 20;
  }

  h3(title) {
    this.ensure(20 + 32);
    this.page.drawText(Doc.sanitize(title), { x: M.left, y: this.y - 9, size: 9.8, font: this.f.bold, color: INK });
    this.y -= 16;
  }

  para(text, { color = INK, size = 9.5, gap = 6 } = {}) { this.text(text, { size, color, gap, leading: 1.46 }); }

  /* Langkah bernomor */
  step(number, title, body) {
    const boxWidth = A4[0] - M.left - M.right;
    const bodyLines = body ? this.wrap(body, 9.2, boxWidth - 34) : [];
    const height = 25 + bodyLines.length * 13.0;
    this.ensure(height + 4);
    const top = this.y;
    this.page.drawCircle({ x: M.left + 8, y: top - 7, size: 8.5, color: INK });
    this.page.drawText(Doc.sanitize(String(number)), { x: M.left + (number > 9 ? 4 : 6.2), y: top - 10.2, size: 8.5, font: this.f.bold, color: rgb(1, 1, 1) });
    this.page.drawText(Doc.sanitize(title), { x: M.left + 23, y: top - 10, size: 9.8, font: this.f.bold, color: INK });
    this.y = top - 19;
    if (bodyLines.length) {
      for (const line of bodyLines) {
        this.page.drawText(line, { x: M.left + 23, y: this.y - 8, size: 9.2, font: this.f.regular, color: MUTED });
        this.y -= 13.0;
      }
    }
    this.y -= 6;
  }

  /* Daftar butir */
  bullets(items, { bullet = "-", size = 9.3, color = MUTED } = {}) {
    for (const item of items) {
      const lines = this.wrap(item, size, A4[0] - M.left - M.right - 16);
      this.ensure(lines.length * 13 + 3);
      this.page.drawText(bullet, { x: M.left + 3, y: this.y - 8, size, font: this.f.regular, color: SUBTLE });
      for (const line of lines) {
        this.page.drawText(line, { x: M.left + 14, y: this.y - 8, size, font: this.f.regular, color });
        this.y -= 13;
      }
      this.y -= 2.5;
    }
    this.y -= 3;
  }

  /* Kotak catatan / peringatan, boleh terpotong antarhalaman */
  callout(title, body, tone = "note") {
    const palette = tone === "warn" ? { bg: rgb(0.992, 0.945, 0.863), bar: rgb(0.541, 0.294, 0), text: rgb(0.42, 0.23, 0) }
      : tone === "danger" ? { bg: rgb(0.984, 0.918, 0.909), bar: DANGER, text: rgb(0.47, 0.15, 0.11) }
        : tone === "ok" ? { bg: rgb(0.909, 0.961, 0.925), bar: OK, text: rgb(0.07, 0.3, 0.19) }
          : { bg: SUNKEN, bar: INK, text: INK };
    const width = A4[0] - M.left - M.right;
    let lines = body ? this.wrap(body, 9, width - 26) : [];
    const totalHeight = 16 + (title ? 14 : 0) + lines.length * 13 + 10;
    const avail = this.page ? this.y - M.bottom : 0;
    // muat utuh di sisa halaman ini
    if (totalHeight + 4 <= avail) { this.drawCalloutBox(palette, width, title, lines); return; }
    // sisa ruang terlalu sempit: mulai di halaman baru
    if (totalHeight > avail && avail < 30 + (title ? 14 : 0)) { this.newPage(); }

    this.drawCalloutBox(palette, width, title, lines);
    return;
  }

  drawCalloutBox(palette, width, title, lines) {
    const height = 16 + (title ? 14 : 0) + lines.length * 13 + 10;
    const top = this.y;
    this.page.drawRectangle({ x: M.left, y: top - height, width, height, color: palette.bg });
    this.page.drawRectangle({ x: M.left, y: top - height, width: 2.5, height, color: palette.bar });
    let cursor = top - 14;
    if (title) {
      this.page.drawText(Doc.sanitize(title), { x: M.left + 12, y: cursor, size: 9.2, font: this.f.bold, color: palette.text });
      cursor -= 14;
    }
    for (const line of lines) {
      this.page.drawText(line, { x: M.left + 12, y: cursor, size: 9, font: this.f.regular, color: palette.text });
      cursor -= 13;
    }
    this.y = top - height - 10;
  }

  /* Tabel sederhana: kolom = [{label, width(relative), align}] */
  table(columns, rows, { caption } = {}) {
    if (columns.some((c) => typeof c.width !== "number")) {
      const missing = columns.filter((c) => typeof c.width !== "number");
      const used = columns.reduce((s, c) => s + (c.width || 0), 0);
      const share = Math.max(8, (100 - used) / missing.length);
      columns = columns.map((c) => (typeof c.width === "number" ? c : { ...c, width: share }));
    }
    const total = columns.reduce((s, c) => s + c.width, 0);
    const width = A4[0] - M.left - M.right;
    const colWidths = columns.map((c) => (c.width / total) * width);
    const drawHeader = () => {
      const top = this.y;
      this.page.drawRectangle({ x: M.left, y: top - 20, width, height: 20, color: SUNKEN });
      let x = M.left;
      columns.forEach((col, i) => {
        const label = Doc.sanitize(col.label.toUpperCase());
        const w = this.width(label, 7.4, true);
        this.page.drawText(label, { x: col.align === "right" ? x + colWidths[i] - 8 - w : x + 8, y: top - 13.4, size: 7.4, font: this.f.bold, color: MUTED });
        x += colWidths[i];
      });
      this.page.drawLine({ start: { x: M.left, y: top - 20 }, end: { x: M.left + width, y: top - 20 }, thickness: 0.7, color: RULE });
      this.y = top - 20;
    };
    this.ensure(46);
    drawHeader();
    for (const row of rows) {
      const cellLines = row.map((cell, i) => this.wrap(String(cell), 8.8, colWidths[i] - 16));
      const height = Math.max(...cellLines.map((l) => l.length)) * 12.3 + 8;
      if (this.y - height < M.bottom) { this.newPage(); drawHeader(); }
      let x = M.left;
      const top = this.y;
      cellLines.forEach((lines, i) => {
        lines.forEach((line, li) => {
          const w = this.width(line, 8.8, i === 0);
          this.page.drawText(line, { x: columns[i].align === "right" ? x + colWidths[i] - 8 - w : x + 8, y: top - 12 - li * 12.3, size: 8.8, font: i === 0 ? this.f.bold : this.f.regular, color: i === 0 ? INK : MUTED });
        });
        x += colWidths[i];
      });
      this.y = top - height;
      this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + width, y: this.y }, thickness: 0.4, color: rgb(0.929, 0.937, 0.91) });
    }
    this.y -= 10;
    if (caption) this.text(caption, { size: 8, color: SUBTLE, gap: 6 });
  }

  /* Halaman sampul */
  cover({ title, subtitle, meta, bullets }) {
    this.newPage();
    const { width, height } = { width: A4[0], height: A4[1] };
    this.page.drawRectangle({ x: 0, y: height - 300, width, height: 300, color: INK });
    // pola garis halus
    for (let x = 0; x < width; x += 34) this.page.drawLine({ start: { x, y: height - 300 }, end: { x, y: height }, thickness: 0.4, color: rgb(0.16, 0.2, 0.18) });
    for (let y = height - 300; y < height; y += 34) this.page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.4, color: rgb(0.16, 0.2, 0.18) });

    this.page.drawRectangle({ x: M.left, y: height - 96, width: 26, height: 26, color: LIME });
    this.page.drawText("A", { x: M.left + 8.4, y: height - 87, size: 13, font: this.f.bold, color: INK });
    this.page.drawText("ARDAYA EPC", { x: M.left + 34, y: height - 80, size: 10, font: this.f.bold, color: rgb(1, 1, 1) });
    this.page.drawText("PROJECT CONTROL", { x: M.left + 34, y: height - 92, size: 7, font: this.f.regular, color: rgb(0.71, 0.74, 0.72) });

    let ty = height - 160;
    for (const line of this.wrap(title, 27, width - M.left - M.right, true)) {
      this.page.drawText(line, { x: M.left, y: ty, size: 27, font: this.f.bold, color: rgb(1, 1, 1) });
      ty -= 32;
    }
    ty -= 6;
    for (const line of this.wrap(subtitle, 11, width - M.left - M.right - 60)) {
      this.page.drawText(line, { x: M.left, y: ty, size: 11, font: this.f.regular, color: rgb(0.75, 0.78, 0.76) });
      ty -= 16;
    }

    this.y = height - 340;
    for (const item of bullets) {
      const lines = this.wrap(item.body, 9.3, width - M.left - M.right - 170);
      this.ensure(lines.length * 14 + 22);
      const top = this.y;
      this.page.drawText(Doc.sanitize(item.label), { x: M.left, y: top - 10, size: 8.4, font: this.f.bold, color: MUTED });
      let ly = top - 10;
      for (const line of lines) {
        this.page.drawText(line, { x: M.left + 120, y: ly, size: 9.3, font: this.f.regular, color: INK });
        ly -= 13;
      }
      this.y = top - Math.max(lines.length * 13, 14) - 12;
      this.page.drawLine({ start: { x: M.left, y: this.y + 4 }, end: { x: width - M.right, y: this.y + 4 }, thickness: 0.4, color: LINE });
    }

    this.y = M.bottom + 40;
    this.text(meta, { size: 8, color: SUBTLE, gap: 2 });
  }

  /* Daftar isi (halaman 2). Nomor halaman isi digeser sebesar offset. */
  tocPage(entries) {
    this.newPage();
    this.page.drawText(clean("DAFTAR ISI"), { x: M.left, y: this.y - 14, size: 15, font: this.f.bold, color: INK });
    this.y -= 42;
    this.page.drawRectangle({ x: M.left, y: this.y + 6, width: 46, height: 2.5, color: LIME });
    this.y -= 6;
    this.page.drawText(clean("Nomor halaman mengikuti angka pada sudut kanan bawah. Setiap bab dimulai di halaman baru."), { x: M.left, y: this.y - 8, size: 8.2, font: this.f.regular, color: SUBTLE });
    this.y -= 22;
    for (const entry of entries) {
      const title = this.wrap(entry.title, 10, A4[0] - M.left - M.right - 90)[0];
      this.page.drawText(clean(entry.num), { x: M.left + 2, y: this.y - 10, size: 8, font: this.f.regular, color: SUBTLE });
      this.page.drawText(title, { x: M.left + 26, y: this.y - 10, size: 9.6, font: this.f.regular, color: INK });
      const dotsStart = M.left + 26 + this.width(title, 9.6) + 6;
      const label = String(entry.page);
      const w = this.width(label, 8.6, true);
      // titik penuntun
      for (let x = dotsStart; x < A4[0] - M.right - w - 8; x += 4) {
        this.page.drawCircle({ x, y: this.y - 7.5, size: 0.35, color: rgb(0.8, 0.82, 0.79) });
      }
      this.page.drawText(label, { x: A4[0] - M.right - w, y: this.y - 10, size: 8.6, font: this.f.bold, color: MUTED });
      this.y -= 18.5;
    }
    this.y -= 6;
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: A4[0] - M.right, y: this.y }, thickness: 0.5, color: LINE });
  }

  /* Header + footer setiap halaman */
  decorate() {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const isCover = index === 0;
      if (!isCover) {
        page.drawText("Panduan Ardaya EPC", { x: M.left, y: A4[1] - 34, size: 7.4, font: this.f.bold, color: SUBTLE });
        const right = "Project control untuk kontraktor EPC elektro";
        const w = this.width(right, 7.4);
        page.drawText(right, { x: A4[0] - M.right - w, y: A4[1] - 34, size: 7.4, font: this.f.regular, color: SUBTLE });
        page.drawLine({ start: { x: M.left, y: A4[1] - 42 }, end: { x: A4[0] - M.right, y: A4[1] - 42 }, thickness: 0.5, color: LINE });
      }
      const footerY = 34;
      page.drawLine({ start: { x: M.left, y: footerY + 12 }, end: { x: A4[0] - M.right, y: footerY + 12 }, thickness: 0.5, color: LINE });
      page.drawText("Ardaya EPC - dokumen internal", { x: M.left, y: footerY, size: 7.2, font: this.f.regular, color: SUBTLE });
      const label = `${index + 1} / ${total}`;
      const w = this.width(label, 7.6, true);
      page.drawText(label, { x: A4[0] - M.right - w, y: footerY, size: 7.6, font: this.f.bold, color: MUTED });
    });
  }
}

/* ---------- Render ---------- */
async function renderBody(fonts) {
  const body = await PDFDocument.create();
  body.registerFontkit(fontkit);
  const doc = new Doc(body, await loadFonts(body));
  for (const chapter of CONTENT.chapters) {
    doc.h1(chapter.num, chapter.title, chapter.kicker);
    // nomor label halaman cetak: 1 sampul + 1 daftar isi + indeks 1-basis
    const entry = doc.toc[doc.toc.length - 1];
    if (entry) entry.page = body.getPageCount() + 2;
    for (const block of chapter.blocks) {
      switch (block.type) {
        case "para": doc.para(block.text); break;
        case "h2": doc.h2(block.text); break;
        case "h3": doc.h3(block.text); break;
        case "bullets": doc.bullets(block.items); break;
        case "steps": block.items.forEach((item, i) => doc.step(i + 1, item.title, item.body)); doc.gap(2); break;
        case "table": doc.table(block.columns, block.rows, { caption: block.caption }); break;
        case "callout": doc.callout(block.title, block.text, block.tone); break;
        case "rule": doc.rule(); break;
        case "kv": doc.bullets(block.items.map((i) => `${i.k}: ${i.v}`)); break;
        default: break;
      }
    }
  }
  return { body, doc };
}

const { body, doc: bodyDoc } = await renderBody();
const tocEntries = bodyDoc.toc;
const bodyPageCount = body.getPageCount();

// dokumen akhir
const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const fonts = await loadFonts(pdf);
const meta = new Doc(pdf, fonts);

meta.cover(CONTENT.cover);           // halaman 1
meta.tocPage(tocEntries); // halaman 2, nomor mengikuti footer (1 = sampul)

// sisipkan halaman isi
const copied = await pdf.copyPages(body, body.getPages().map((_, i) => i));
copied.forEach((page) => pdf.addPage(page));

// header + footer untuk semua halaman
const pages = pdf.getPages();
const total = pages.length;
pages.forEach((page, index) => {
  if (index > 0) {
    page.drawText(clean("Panduan Ardaya EPC"), { x: M.left, y: A4[1] - 34, size: 7.4, font: fonts.bold, color: SUBTLE });
    const right = clean("Project control untuk kontraktor EPC elektro");
    page.drawText(right, { x: A4[0] - M.right - fonts.regular.widthOfTextAtSize(right, 7.4), y: A4[1] - 34, size: 7.4, font: fonts.regular, color: SUBTLE });
    page.drawLine({ start: { x: M.left, y: A4[1] - 42 }, end: { x: A4[0] - M.right, y: A4[1] - 42 }, thickness: 0.5, color: LINE });
    page.drawLine({ start: { x: M.left, y: 46 }, end: { x: A4[0] - M.right, y: 46 }, thickness: 0.5, color: LINE });
    page.drawText(clean("Ardaya EPC - dokumen internal"), { x: M.left, y: 34, size: 7.2, font: fonts.regular, color: SUBTLE });
  }
  const label = `${index + 1} / ${total}`;
  const w = fonts.bold.widthOfTextAtSize(label, 7.6);
  page.drawText(label, { x: A4[0] - M.right - w, y: 34, size: 7.6, font: fonts.bold, color: MUTED });
});

pdf.setTitle("Panduan Ardaya EPC");
pdf.setAuthor("Ardaya EPC");
pdf.setSubject("Panduan penggunaan aplikasi dari awal hingga akhir");
pdf.setKeywords(["EPC", "panduan", "tutorial", "project control"]);
pdf.setCreator("tools/build-docs-pdf.mjs");

mkdirSync(OUT_DIR, { recursive: true });
const bytes = await pdf.save();
writeFileSync(OUT_FILE, bytes);
console.log(`${OUT_FILE} ditulis: ${(bytes.length / 1024).toFixed(0)} KB, ${pdf.getPageCount()} halaman (${bodyPageCount} halaman isi)`);
