#!/usr/bin/env node
/**
 * Perakit papan konsep desain v2.
 * Menggabungkan part*.html lalu menyuntikkan kerangka aplikasi (rail, topbar, tab)
 * secara statis, sehingga hasilnya bisa dibuka langsung dari disk tanpa server
 * dan tanpa JavaScript.
 *
 * Jalankan: node design/v2/build.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const read = (file) => readFileSync(new URL(file, dir), "utf8");

/* ---------- potongan kerangka ---------- */
const icon = (name) => {
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    approvals: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    expenses: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4"/>',
    invoices: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h5"/>',
    documents: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
    opportunities: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    bell: '<path d="M15 17H9a3 3 0 0 1-3-3v-3a6 6 0 1 1 12 0v3a3 3 0 0 1-3 3z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
};

const NAV = [
  { group: "Kerja", items: [
    { id: "dashboard", label: "Ikhtisar" },
    { id: "projects", label: "Proyek" },
    { id: "approvals", label: "Persetujuan", count: 3, hot: true },
    { id: "expenses", label: "Pengeluaran" },
  ] },
  { group: "Komersial", items: [
    { id: "invoices", label: "Tagihan", count: 1 },
    { id: "documents", label: "Dokumen" },
    { id: "opportunities", label: "Peluang" },
  ] },
  { group: "Sistem", items: [
    { id: "activity", label: "Audit Trail" },
    { id: "settings", label: "Pengaturan" },
  ] },
];

const TABS = [
  ["summary", "Ringkasan", ""], ["budget", "Lingkup &amp; Anggaran", ""], ["schedule", "Jadwal &amp; Progres", ""],
  ["procurement", "Pengadaan &amp; Biaya", ""], ["billing", "Tagihan", ""], ["changes", "Change Order", ""],
  ["handover", "Serah Terima", "2"], ["documents", "Dokumen", "8"],
];

const rail = (active) => `<aside class="rail">
      <div class="brand"><span class="mark">A</span><div><div class="name">ARDAYA EPC</div><div class="sub">Project control</div></div></div>
      <div class="workspace"><span class="dot"></span>PT Ardaya Energi Sistem<span class="k">&#9662;</span></div>
${NAV.map((g) => `      <div class="group"><div class="cap">${g.group}</div>
${g.items.map((it) => {
  const cls = `item${it.id === active ? " on" : ""}${it.hot ? " hot" : ""}`;
  const count = it.count ? `<span class="count">${it.count}</span>` : "<span></span>";
  return `        <a class="${cls}" href="#">${icon(it.id)}<span>${it.label}</span>${count}</a>`;
}).join("\n")}
      </div>`).join("\n")}
      <div class="tail"><div class="me"><span class="av">RP</span><div><div class="who">Rizky Pratama</div><div class="role">Project Manager</div></div></div></div>
    </aside>`;

const topbar = (crumb) => `<header class="topbar">
        <div class="crumbs"><span>Ardaya</span><span class="sep">/</span><b>${crumb || "Ikhtisar"}</b></div>
        <div class="search">${icon("search")}Cari proyek, biaya, atau invoice<kbd>&#8984;K</kbd></div>
        <span class="icon-btn">${icon("bell")}<span class="pip"></span></span>
        <span class="icon-btn" style="width:auto;padding:0 9px;gap:6px;font-size:10.5px;font-weight:650">RP<span style="color:var(--subtle)">&#9662;</span></span>
      </header>`;

const tabbar = (active) => `<div class="tabs">${TABS.map(([id, label, n]) =>
  `<a class="${id === active ? "on" : ""}" href="#">${label}${n ? `<span class="n">${n}</span>` : ""}</a>`).join("")}</div>`;

/* ---------- rakit ---------- */
const parts = readdirSync(dir).filter((f) => /^part\d+\.html$/.test(f)).sort();
let html = parts.map(read).join("");

let injected = 0;
html = html.replace(/<div class="canvas"([^>]*)>(\s*)<div class="body"/g, (match, attrs, space) => {
  if (attrs.includes('data-bare="true"')) return match;
  const nav = (attrs.match(/data-nav="([^"]+)"/) || [, "dashboard"])[1];
  const crumb = (attrs.match(/data-crumb="([^"]*)"/) || [, ""])[1];
  const tab = (attrs.match(/data-tabs="([^"]+)"/) || [, ""])[1];
  injected += 1;
  return `<div class="canvas"${attrs}>${rail(nav)}<div class="body">${topbar(crumb)}${tab ? tabbar(tab) : ""}`;
});

/* Skala layar: 1440 px diskalakan ke lebar wadah, dihitung sekali saat muat + saat ukuran berubah */
const fitScript = `<script>
(function () {
  function fit() {
    document.querySelectorAll('.viewport[data-w="1440"]').forEach(function (vp) {
      var s = vp.clientWidth / 1440;
      vp.style.setProperty("--s", s.toFixed(4));
      var canvas = vp.querySelector('.canvas');
      if (canvas) vp.style.height = Math.ceil(canvas.offsetHeight * s) + 'px';
    });
  }
  window.addEventListener("resize", fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("load", fit);
  fit();
})();
</script>
`;
html = html.replace("</body>", fitScript + "</body>");

writeFileSync(new URL("index.html", dir), html);
console.log(`design/v2/index.html ditulis: ${(html.length / 1024).toFixed(0)} KB, ${injected} layar berkerangka, ${parts.length} bagian`);
