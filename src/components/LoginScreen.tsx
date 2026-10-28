"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Input, Field } from "@/components/ui";

const accounts = [
  { role: "PM", email: "pm@ardaya.id", name: "Bagas Prasetyo", detail: "Proyek, biaya & approval" },
  { role: "FINANCE", email: "finance@ardaya.id", name: "Maya Puspita", detail: "Tagihan, PPh & reimburse" },
  { role: "FIELD", email: "field@ardaya.id", name: "Rizky Ramadhan", detail: "Pengeluaran & progres site" },
  { role: "ADMIN", email: "admin@ardaya.id", name: "Aditya Nugraha", detail: "Seluruh kontrol & override" },
];
export default function LoginScreen({ demoPassword }: { demoPassword: string | null }) {
  const router = useRouter(); const [email, setEmail] = useState("pm@ardaya.id"); const [password, setPassword] = useState(demoPassword || ""); const [show, setShow] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const login = async (loginEmail = email, loginPassword = password) => {
    setLoading(true); setError("");
    try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Login gagal."); setLoading(false); }
  };
  return <main className="grid min-h-dvh bg-[#f4f5f1] lg:grid-cols-[1.12fr_.88fr]">
    <section className="relative hidden min-h-dvh overflow-hidden bg-ink lg:block">
      <motion.div className="absolute inset-0 bg-[url('/images/epc-hero.jpg')] bg-cover bg-center" initial={{ scale: 1.12, opacity: 0 }} animate={{ scale: 1, opacity: .62 }} transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }} />
      <div className="absolute inset-0 bg-gradient-to-t from-[#101813] via-[#101813]/45 to-[#101813]/25" />
      <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }} className="flex items-center gap-3 text-white"><span className="grid h-10 w-10 place-items-center rounded-xl bg-lime text-ink"><Zap size={20} fill="currentColor" /></span><div><p className="font-display text-base font-bold tracking-tight">ARDAYA<span className="text-lime">/</span>EPC</p><p className="text-[9px] uppercase tracking-[.25em] text-white/55">Project control system</p></div></motion.div>
        <div className="max-w-2xl">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .45 }} className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-lime"><span className="h-px w-8 bg-lime" />Satu sumber kebenaran proyek</motion.p>
          <div className="overflow-hidden"><motion.h1 initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ delay: .3, duration: .8, ease: [0.22, 1, 0.36, 1] }} className="font-display text-[clamp(3rem,5.5vw,5.7rem)] font-medium leading-[.96] tracking-[-.055em] text-white">Dari nota lapangan<br />hingga <span className="text-lime">BAST.</span></motion.h1></div>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .75 }} className="mt-7 max-w-lg text-base leading-relaxed text-white/65">Kendalikan biaya, komitmen, penagihan, dan serah terima proyek elektro dalam satu alur yang dapat diaudit.</motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .95 }} className="mt-10 flex gap-7 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck size={15} className="text-lime" />RBAC per proyek</span><span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-lime" />Audit append-only</span></motion.div>
        </div>
        <p className="text-[10px] uppercase tracking-[.18em] text-white/35">Engineering · Procurement · Construction</p>
      </div>
    </section>
    <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }} className="w-full max-w-md">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-lime"><Zap size={20} /></span><p className="font-display font-bold">ARDAYA/EPC</p></div>
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-muted">Workspace kontraktor EPC</p><h2 className="mt-3 font-display text-4xl font-semibold tracking-[-.045em] text-ink">Selamat datang.</h2><p className="mt-3 text-sm leading-relaxed text-muted">Masuk untuk melanjutkan kontrol proyek. Akses menyesuaikan peran dan keanggotaan proyek Anda.</p>
        <form className="mt-8 space-y-4" onSubmit={(e) => { e.preventDefault(); void login(); }}>
          <Field label="Email kantor"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><div className="relative"><Input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="pr-12" /><button type="button" onClick={() => setShow(!show)} aria-label="Tampilkan password" className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-ink/5">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
          {error ? <motion.p initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">{error}</motion.p> : null}
          <Button type="submit" size="lg" loading={loading} className="w-full">Masuk ke workspace<ArrowRight size={17} /></Button>
        </form>
        <div className="my-7 flex items-center gap-3"><span className="h-px flex-1 bg-line" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Akun demo</span><span className="h-px flex-1 bg-line" /></div>
        <div className="grid gap-2 sm:grid-cols-2">{accounts.map((account) => <button key={account.role} disabled={loading} onClick={() => { setEmail(account.email); setPassword(demoPassword || ""); if (demoPassword) void login(account.email, demoPassword); }} className="group rounded-xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-sm disabled:opacity-50"><div className="flex items-center justify-between"><span className="text-[10px] font-bold tracking-wider text-ink">{account.role}</span><ArrowRight size={13} className="text-muted transition group-hover:translate-x-1" /></div><p className="mt-1.5 text-xs font-semibold text-ink">{account.name}</p><p className="mt-0.5 text-[10px] text-muted">{account.detail}</p></button>)}</div>
        <p className="mt-5 flex items-start gap-2 text-[10px] leading-relaxed text-muted"><LockKeyhole size={13} className="mt-0.5 shrink-0" />{demoPassword ? `Password demo: ${demoPassword}. Pemilihan akun tetap diverifikasi oleh server.` : "Password demo dikonfigurasi melalui SEED_DEMO_PASSWORD. Pilih akun untuk mengisi email, lalu masukkan password."}</p>
      </motion.div>
    </section>
  </main>;
}
