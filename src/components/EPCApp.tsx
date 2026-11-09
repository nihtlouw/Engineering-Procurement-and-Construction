"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Activity, Bell, Compass, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, ClipboardCheck, FileText, FolderKanban, LayoutDashboard, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Users, X, Zap } from "lucide-react";
import Dashboard from "@/components/Dashboard";
import SettingsView from "@/components/SettingsView";
import ProjectWorkspace from "@/components/ProjectWorkspace";
import { ApprovalInbox, ExpenseComposer, ExpenseLedger } from "@/components/ExpenseViews";
import { InvoiceCenter, InvoiceComposer, PurchaseComposer } from "@/components/FinanceViews";
import { DocumentComposer, DocumentsCenter } from "@/components/DocumentsView";
import type { ActivityView, AppData, PurchaseView } from "@/components/types";
import { Badge, Button, EmptyState, Input, SectionTitle, Toast } from "@/components/ui";
import { LABELS, PERMISSIONS } from "@/lib/domain";
import { api } from "@/lib/client";
import { formatDate, formatIDR } from "@/lib/format";

const navItems = [
  { id: "dashboard", label: "Ikhtisar", icon: LayoutDashboard, permission: "portfolio.view", group: "Kerja" },
  { id: "projects", label: "Proyek", icon: FolderKanban, group: "Kerja" },
  { id: "approvals", label: "Persetujuan", icon: ClipboardCheck, group: "Kerja" },
  { id: "expenses", label: "Pengeluaran", icon: CircleDollarSign, group: "Kerja" },
  { id: "invoices", label: "Tagihan", icon: BriefcaseBusiness, permission: "invoice.view", group: "Komersial" },
  { id: "documents", label: "Dokumen", icon: FileText, permission: "document.view", group: "Komersial" },
  { id: "opportunities", label: "Peluang", icon: BriefcaseBusiness, permission: "opportunity.view", group: "Komersial" },
  { id: "activity", label: "Audit Trail", icon: Activity, permission: "audit.view", group: "Sistem" },
  { id: "settings", label: "Pengaturan", icon: Settings, permission: "settings.manage", group: "Sistem" },
];
const NAV_GROUPS = ["Kerja", "Komersial", "Sistem"];
type Composer = "expense" | "purchase" | "invoice" | "document" | null;

export default function EPCApp({ initialData }: { initialData: AppData }) {
  const data = initialData; const router = useRouter(); const [isPending, startTransition] = useTransition();
  const [view, setView] = useState(data.user.role === "FIELD" ? "projects" : "dashboard"); const [projectId, setProjectId] = useState(data.projects[0]?.id || ""); const [projectTab, setProjectTab] = useState("summary"); const [mobileNav, setMobileNav] = useState(false); const [composer, setComposer] = useState<Composer>(null); const [purchasePrefill, setPurchasePrefill] = useState<PurchaseView | null>(null); const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null); const [search, setSearch] = useState(""); const [searchOpen, setSearchOpen] = useState(false); const [notificationsOpen, setNotificationsOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false);
  const syncHash = (next: string, pid: string, tab?: string) => {
    const suffix = next === "projects" && pid ? `/${pid}${tab ? `/${tab}` : ""}` : "";
    const target = `#/${next}${suffix}`;
    if (window.location.hash !== target) window.history.pushState(null, "", target);
  };
  useEffect(() => {
    const applyHash = () => {
      const [next, pid, tab] = window.location.hash.replace(/^#\/?/, "").split("/");
      if (next && navItems.some((n) => n.id === next)) setView(next);
      if (pid && data.projects.some((p) => p.id === pid)) setProjectId(pid);
      if (tab && ["summary", "budget", "schedule", "procurement", "billing", "changes", "handover", "documents"].includes(tab)) setProjectTab(tab);
    };
    applyHash();
    window.addEventListener("popstate", applyHash);
    window.addEventListener("hashchange", applyHash);
    return () => { window.removeEventListener("popstate", applyHash); window.removeEventListener("hashchange", applyHash); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const savedView = localStorage.getItem("epc-view"); const savedProject = localStorage.getItem("epc-project"); const savedTab = localStorage.getItem("epc-tab"); if (savedView && navItems.some((n) => n.id === savedView)) setView(savedView); if (savedProject && data.projects.some((p) => p.id === savedProject)) setProjectId(savedProject); if (savedTab) setProjectTab(savedTab); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  const project = data.projects.find((p) => p.id === projectId) || data.projects[0];const unreadCount = data.notifications.filter((n) => !n.readAt).length; const pendingCount = data.expenses.filter((e) => e.approvalStatus === "SUBMITTED" && (e.assignedApproverId === data.user.id || data.user.role === "ADMIN")).length;
  const navigate = (next: string) => { setView(next); localStorage.setItem("epc-view", next); setMobileNav(false); setSearchOpen(false); syncHash(next, projectId); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const selectProject = (id: string) => { setProjectId(id); localStorage.setItem("epc-project", id); setView("projects"); localStorage.setItem("epc-view", "projects"); setMobileNav(false); syncHash("projects", id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const changeTab = (tab: string) => { setProjectTab(tab); localStorage.setItem("epc-tab", tab); syncHash("projects", projectId, tab); };
  const saved = (message: string) => { setToast({ type: "success", message }); startTransition(() => router.refresh()); };
  const allowedNav = navItems.filter((n) => !n.permission || data.user.permissions.includes(n.permission as (typeof PERMISSIONS)[number]));
  const searchResults = useMemo(() => { if (!search.trim()) return []; const q = search.toLowerCase(); return [...data.projects.filter((p) => `${p.code} ${p.title} ${p.clientName}`.toLowerCase().includes(q)).slice(0, 4).map((p) => ({ id: p.id, type: "Proyek", title: p.title, meta: p.code, view: "projects" })), ...data.expenses.filter((e) => `${e.code} ${e.merchantName}`.toLowerCase().includes(q)).slice(0, 3).map((e) => ({ id: e.id, type: "Biaya", title: e.merchantName || e.code, meta: `${e.code} · ${formatIDR(e.totalAmount, true)}`, view: "expenses" })), ...data.invoices.filter((i) => i.number.toLowerCase().includes(q)).slice(0, 3).map((i) => ({ id: i.id, type: "Invoice", title: i.number, meta: `${i.projectCode} · ${formatIDR(i.balance, true)}`, view: "invoices" }))]; }, [search, data]);
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); router.refresh(); };
  const openExpense = (po?: PurchaseView) => { setPurchasePrefill(po || null); setComposer("expense"); };
  return <div className="min-h-dvh bg-paper lg:flex"><aside className="sticky top-0 z-40 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-white/[.06] bg-ink-900 text-white lg:flex">
      <div className="flex h-[58px] items-center gap-2.5 border-b border-white/[.06] px-4">
        <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-lime text-[13px] font-extrabold text-ink">A</span>
        <div className="min-w-0"><p className="truncate text-[12px] font-bold tracking-[.01em]">ARDAYA EPC</p><p className="text-[9.5px] uppercase tracking-[.16em] text-[#7d8a83]">Project control</p></div>
      </div>
      <div className="mx-2.5 mt-2.5 flex items-center gap-2 rounded-[var(--radius-control)] border border-white/[.07] bg-white/[.03] px-2.5 py-1.5">
        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-lime" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#cfd8d2]">PT Ardaya Energi Sistem</span>
        <ChevronDown size={12} className="shrink-0 text-[#7d8a83]" />
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 pb-3 pt-1.5">
        {NAV_GROUPS.map((group) => {
          const items = allowedNav.filter((n) => n.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="mt-2.5 first:mt-1">
              <p className="mb-1 px-2 text-[9.5px] font-bold uppercase tracking-[.16em] text-[#66736b]">{group}</p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button key={item.id} onClick={() => navigate(item.id)} className={`relative flex h-[32px] w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left text-[12px] transition-colors ${view === item.id ? "bg-lime font-semibold text-ink" : "text-[#b9c4bd] hover:bg-white/[.05] hover:text-white"}`}>
                    <item.icon size={14} className={view === item.id ? "text-ink" : "opacity-80"} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.id === "approvals" && pendingCount ? <span className={`grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold ${view === item.id ? "bg-ink/15 text-ink" : "bg-lime text-ink"}`}>{pendingCount}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="mx-2.5 mb-2.5 rounded-[var(--radius-control)] border border-white/[.07] bg-white/[.02] px-2.5 py-2">
        <div className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-lime" /><span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#7d8a83]">Kontrol aktif</span></div>
        <p className="mt-1 text-[10px] leading-relaxed text-[#7d8a83]">RBAC, cakupan proyek, DPP, separation of duty, audit append only.</p>
      </div>
      <button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2.5 border-t border-white/[.07] px-3 py-3 text-left hover:bg-surface/[.03]">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-[11px] font-bold text-ink">{data.user.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-semibold">{data.user.name}</span><span className="mt-0.5 block truncate text-[11px] text-[#B4BCB7]">{data.user.title}</span></span>
        <ChevronDown size={13} className="text-[#B4BCB7]" />
      </button>
    </aside>
    <AnimatePresence>{mobileNav ? <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)} className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm lg:hidden" /><motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} className="fixed inset-y-0 left-0 z-[60] flex w-64 flex-col bg-ink-900 p-4 text-white lg:hidden"><div className="mb-6 flex items-center justify-between"><span className="font-bold">ARDAYA<span className="text-lime">/</span>EPC</span><button onClick={() => setMobileNav(false)}><X /></button></div><nav className="space-y-1">{allowedNav.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm ${view === item.id ? "bg-surface/10 text-lime" : "text-[#B4BCB7]"}`}><item.icon size={18} />{item.label}</button>)}</nav><button onClick={() => void logout()} className="mt-auto flex min-h-12 items-center gap-3 text-sm text-[#B4BCB7]"><LogOut size={17} />Keluar</button></motion.aside></> : null}</AnimatePresence>
    <div className="min-w-0 flex-1"><header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-paper/92 px-4 backdrop-blur-md sm:px-5">
        {isPending ? <span className="absolute inset-x-0 bottom-[-1px] h-[2px] overflow-hidden bg-lime-soft" aria-hidden><span className="block h-full w-1/3 animate-[pending-slide_1.1s_ease-in-out_infinite] rounded-full bg-lime-bright" /></span> : null}
        <button onClick={() => setMobileNav(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink hover:bg-paper-2 lg:hidden" aria-label="Buka navigasi"><Menu size={17} /></button>
        <div className="hidden min-w-0 items-center gap-1.5 md:flex">
          <span className="text-[11px] text-subtle">Ardaya</span>
          <span className="text-[11px] text-line-strong">/</span>
          <span className="truncate text-[11.5px] font-semibold text-ink">{allowedNav.find((n) => n.id === view)?.label}</span>
          {view === "projects" && project ? <><span className="text-[11px] text-line-strong">/</span><span className="mono hidden truncate text-[11px] text-muted lg:inline">{project.code}</span></> : null}
        </div>
        {view === "projects" && data.projects.length > 1 ? <SelectProject projects={data.projects} value={project?.id || ""} onChange={(id) => { setProjectId(id); localStorage.setItem("epc-project", id); }} /> : null}
        <div className="relative ml-auto w-full max-w-[280px] sm:w-64">
          <Search size={14} className="absolute left-2.5 top-2.5 text-subtle" />
          <Input value={search} onFocus={() => setSearchOpen(true)} onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }} placeholder="Cari proyek, biaya, atau invoice" aria-label="Cari" className="min-h-8 h-8 rounded-[var(--radius-control)] bg-surface pl-8 text-[11.5px]" />
          {searchOpen && search ? <><button className="fixed inset-0 z-10 cursor-default" onClick={() => setSearchOpen(false)} aria-label="Tutup pencarian" /><motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .14 }} className="absolute left-0 right-0 top-10 z-20 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-e3)]">{searchResults.length ? searchResults.map((r) => <button key={`${r.type}-${r.id}`} onClick={() => { if (r.type === "Proyek") selectProject(r.id); else navigate(r.view); setSearch(""); }} className="flex w-full items-center gap-2.5 border-b border-hairline p-2.5 text-left last:border-0 hover:bg-paper"><span className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">{r.type}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold">{r.title}</span><span className="mt-0.5 block truncate text-[11px] text-muted">{r.meta}</span></span><ChevronRight size={13} className="text-subtle" /></button>) : <p className="p-4 text-center text-[12.5px] text-muted">Tidak ada hasil dalam cakupan akses Anda.</p>}</motion.div></> : null}
        </div>
        <div className="relative">
          <button onClick={() => setNotificationsOpen(!notificationsOpen)} aria-haspopup="dialog" aria-expanded={notificationsOpen} className="relative grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink hover:bg-paper-2" aria-label={unreadCount ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}><Bell size={15} />{unreadCount ? <><span className="absolute right-1.5 top-1.5 h-[6px] w-[6px] rounded-full bg-danger" /><span className="sr-only">{unreadCount} notifikasi belum dibaca</span></> : null}</button>
          <AnimatePresence>{notificationsOpen ? <><button className="fixed inset-0 z-10" onClick={() => setNotificationsOpen(false)} /><motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .14 }} className="absolute right-0 top-10 z-20 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-e3)]"><p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[.1em] text-muted">Notifikasi</p>{data.notifications.length ? data.notifications.map((n) => <button key={String(n.id)} onClick={() => { if (n.link) navigate(String(n.link)); setNotificationsOpen(false); }} className="w-full border-b border-hairline p-3 text-left last:border-0 hover:bg-paper"><p className="text-[12.5px] font-semibold">{String(n.title)}</p><p className="mt-1 text-[11.5px] leading-relaxed text-muted">{String(n.body)}</p><p className="mono mt-1.5 text-[11px] text-subtle">{formatDate(n.createdAt as string)}</p></button>) : <p className="p-5 text-center text-[12.5px] text-muted">Tidak ada notifikasi.</p>}</motion.div></> : null}</AnimatePresence>
        </div>
        <button onClick={() => setProfileOpen(!profileOpen)} className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[11px] font-bold text-lime lg:hidden">{data.user.name[0]}</button>
        <AnimatePresence>{profileOpen ? <><button className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} /><motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .14 }} className="absolute bottom-[68px] left-3 z-50 w-60 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-ink shadow-[var(--shadow-e3)] lg:bottom-3 lg:left-3"><p className="text-[13px] font-semibold">{data.user.name}</p><p className="mt-0.5 text-[11.5px] text-muted">{data.user.email}</p><div className="mt-2"><Badge value={data.user.role} label={data.user.title} /></div><Button variant="ghost" size="sm" className="mt-3 w-full justify-start" onClick={() => void logout()}><LogOut size={14} />Keluar / ganti peran</Button></motion.div></> : null}</AnimatePresence>
      </header>
      <main className="px-4 pb-24 pt-5 sm:px-5 sm:pb-24 lg:px-7 lg:pb-10 lg:pt-6"><AnimatePresence mode="wait"><motion.div key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .16, ease: [0.22, 1, 0.36, 1] }}>{view === "dashboard" ? <Dashboard data={data} onOpenProject={selectProject} onCreateExpense={() => openExpense()} onNavigate={navigate} /> : view === "projects" && project ? <ProjectWorkspace data={data} project={project} tab={projectTab} onTab={changeTab} onSaved={saved} onCreateExpense={() => openExpense()} onCreatePurchase={() => setComposer("purchase")} onBillPurchase={(po) => openExpense(po)} onCreateInvoice={() => setComposer("invoice")} onCreateDocument={() => setComposer("document")} /> : view === "approvals" ? <ApprovalInbox data={data} onSaved={saved} /> : view === "expenses" ? <ExpenseLedger data={data} onCreate={() => openExpense()} onSaved={saved} /> : view === "invoices" ? <InvoiceCenter data={data} onSaved={saved} onCreate={() => setComposer("invoice")} /> : view === "documents" ? <DocumentsCenter data={data} onSaved={saved} onCreate={() => setComposer("document")} /> : view === "opportunities" ? <Opportunities data={data} onOpenProject={selectProject} /> : view === "activity" ? <AuditTrail activities={data.activities} projects={data.projects} /> : view === "settings" ? <SettingsView data={data} onSaved={saved} /> : <EmptyState icon={<Compass size={18} />} title="Modul tidak tersedia" description="Modul ini di luar cakupan peran Anda. Hubungi admin proyek bila aksesnya diperlukan." />}</motion.div></AnimatePresence></main>
    </div>
    <nav className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-[var(--radius-card)] border border-white/10 bg-ink-900/96 p-1 text-white shadow-[var(--shadow-e3)] backdrop-blur-xl lg:hidden">{allowedNav.filter((n) => ["dashboard", "projects", "approvals", "expenses", "invoices"].includes(n.id)).slice(0, 4).map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={`relative flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] text-[10.5px] font-medium transition-colors ${view === item.id ? "text-lime" : "text-[#b9c4bd]"}`}>{view === item.id ? <span className="absolute inset-x-2 top-0 h-[2px] rounded-full bg-lime" /> : null}<item.icon size={17} />{item.label}</button>)}</nav>
    <ExpenseComposer data={data} open={composer === "expense"} onClose={() => { setComposer(null); setPurchasePrefill(null); }} onSaved={saved} projectId={project?.id} purchase={purchasePrefill} />
    <PurchaseComposer data={data} open={composer === "purchase"} onClose={() => setComposer(null)} onSaved={saved} projectId={project?.id} />
    <InvoiceComposer data={data} open={composer === "invoice"} onClose={() => setComposer(null)} onSaved={saved} projectId={project?.id} />
    <DocumentComposer data={data} open={composer === "document"} onClose={() => setComposer(null)} onSaved={saved} projectId={project?.id} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>;
}

function SelectProject({ projects, value, onChange }: { projects: AppData["projects"]; value: string; onChange: (id: string) => void }) { return <div className="relative ml-3 hidden lg:block"><select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-10 max-w-72 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold outline-none"><option value="" disabled>Pilih proyek</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></div>; }
function Opportunities({ data, onOpenProject }: { data: AppData; onOpenProject: (id: string) => void }) { return <div><SectionTitle eyebrow="Peluang & tender" title="Peluang" description="Pipeline peluang dari kualifikasi hingga keputusan. Proyek hasil konversi terhubung satu kali ke peluang asal." /><div className="grid gap-4 lg:grid-cols-3">{data.opportunities.map((o, index) => <motion.article key={o.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .08 }} className="rounded-[var(--radius-card)] border border-line bg-surface p-5"><div className="flex items-center justify-between"><span className="text-[11px] font-bold text-muted">{o.code}</span><Badge value={o.status} /></div><h2 className="mt-4 text-lg font-semibold leading-6">{o.title}</h2><p className="mt-2 text-xs text-muted">{o.clientName} · Owner {o.ownerName}</p><p className="mt-4 text-xs leading-relaxed text-muted">{o.requirement}</p><div className="mt-5 flex items-end justify-between border-t border-line pt-4"><div><p className="text-[11px] text-muted">Estimasi nilai</p><p className="mt-1 text-xl font-semibold tabular">{formatIDR(o.estimatedValue, true)}</p></div><p className="text-[11px] text-muted">Tenggat {formatDate(o.dueDate)}</p></div>{o.converted ? <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-control)] bg-ok-bg p-3 text-[11px] text-ok"><CheckCircle2 size={14} />Sudah terkonversi satu kali menjadi proyek.</p> : null}</motion.article>)}</div></div>; }
function AuditTrail({ activities, projects }: { activities: ActivityView[]; projects: AppData["projects"] }) { return <div><SectionTitle eyebrow="Jejak perubahan" title="Jejak audit" description="Perubahan status, nilai, persetujuan, pembayaran, baseline, dan dokumen tercatat dengan aktor, waktu, nilai lama/baru, serta alasan." /><div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">{activities.length ? activities.map((a) => <div key={a.id} className="grid gap-3 border-b border-hairline px-4 py-3 last:border-0 sm:grid-cols-[150px_1fr_auto]"><div><p className="text-xs font-semibold">{a.actorName}</p><p className="mt-1 text-[11px] text-muted">{formatDate(a.createdAt)}</p></div><div><p className="text-xs font-semibold">{a.action} · {a.objectType}</p><p className="mt-1 text-[11px] text-muted">{projects.find((p) => p.id === a.projectId)?.code || "Umum"} · ID {a.objectId.slice(0, 12)}</p>{a.changes?.length ? <div className="mt-2 flex flex-wrap gap-2">{a.changes.map((c, i) => <span key={i} className="rounded bg-paper px-2 py-1 font-mono text-[11px] text-muted">{c.field}: {String(c.old ?? "—")} → {String(c.new ?? "—")}</span>)}</div> : null}{a.reason ? <p className="mt-2 text-[11px] text-warn">Alasan: {a.reason}</p> : null}</div><Activity size={16} className="text-muted" /></div>) : <EmptyState title="Belum ada aktivitas" description="Aktivitas pada cakupan proyek Anda akan tampil di sini." />}</div></div>; }
