"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Input, Field } from "@/components/ui";

/* Halaman masuk — rencana desain v1 bab 09.
   Panel kiri memakai pola garis SVG (bukan foto) supaya tidak ada aset yang gagal dimuat
   dan tidak memuat dekorasi berat. Tombol akun demo hanya tampil bila mode demo aktif. */

const accounts = [
  { role: "PM", email: "pm@ardaya.id", name: "Bagas Prasetyo", detail: "Proyek, biaya & approval" },
  { role: "FINANCE", email: "finance@ardaya.id", name: "Maya Puspita", detail: "Tagihan, PPh & reimburse" },
  { role: "FIELD", email: "field@ardaya.id", name: "Rizky Ramadhan", detail: "Pengeluaran & progres site" },
  { role: "ADMIN", email: "admin@ardaya.id", name: "Aditya Nugraha", detail: "Seluruh kontrol & override" },
];

const EASE = [0.22, 1, 0.36, 1] as const;

export default function LoginScreen({ demoPassword }: { demoPassword: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("pm@ardaya.id");
  const [password, setPassword] = useState(demoPassword || "");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async (loginEmail = email, loginPassword = password) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Login gagal."); setLoading(false); }
  };

  return (
    <main className="grid min-h-dvh bg-paper lg:grid-cols-2">
      {/* Panel identitas */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex xl:p-14">
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[.16]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="login-lines" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M0 0H48M0 0V48" stroke="#FFFFFF" strokeWidth=".6" fill="none" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-lines)" />
        </svg>

        <div className="relative flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[7px] bg-lime text-ink"><Zap size={15} fill="currentColor" /></span>
          <div>
            <p className="text-[12.5px] font-bold tracking-[-.01em]">ARDAYA EPC</p>
            <p className="text-[11px] uppercase tracking-[.14em] text-[#B4BCB7]">Project control</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, ease: EASE }} className="text-[34px] font-semibold leading-[1.08] tracking-[-.03em]">
            Dari nota lapangan<br />sampai <span className="text-lime">BAST</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .12, duration: .4 }} className="mt-3.5 max-w-sm text-[13px] leading-relaxed text-[#B4BCB7]">
            Satu alur biaya, komitmen, tagihan, dan serah terima yang bisa diaudit sampai ke bukti dan persetujuannya.
          </motion.p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[11.5px] text-[#B4BCB7]">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-lime" />RBAC per proyek</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-lime" />Audit append only</span>
          </div>
        </div>

        <p className="relative text-[11px] uppercase tracking-[.14em] text-[#B4BCB7]">Engineering · Procurement · Construction</p>
      </section>

      {/* Formulir */}
      <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3, ease: EASE }} className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-[7px] bg-ink text-lime"><Zap size={15} /></span>
            <p className="text-[13px] font-bold">ARDAYA EPC</p>
          </div>

          <h2 className="text-[21px] font-semibold tracking-[-.025em]">Selamat datang</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Masuk untuk melanjutkan kontrol proyek. Akses menyesuaikan peran dan keanggotaan proyek Anda.</p>

          <form className="mt-6 space-y-3.5" onSubmit={(e) => { e.preventDefault(); void login(); }}>
            <Field label="Email kantor"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Kata sandi">
              <div className="relative">
                <Input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="pr-11" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} className="absolute right-0.5 top-0.5 grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {error ? <p role="alert" className="rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] leading-relaxed text-danger">{error}</p> : null}
            <Button type="submit" size="lg" loading={loading} className="w-full">Masuk ke workspace<ArrowRight size={16} /></Button>
          </form>

          {demoPassword ? (
            <>
              <div className="my-6 flex items-center gap-2.5">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Akun demo</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {accounts.map((account) => (
                  <button key={account.role} disabled={loading} onClick={() => { setEmail(account.email); setPassword(demoPassword); void login(account.email, demoPassword); }} className="rounded-[var(--radius-control)] border border-line-strong bg-surface p-2.5 text-left transition-colors hover:border-ink-500 hover:bg-paper-2 disabled:opacity-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{account.role}</span>
                      <ArrowRight size={12} className="text-subtle" />
                    </div>
                    <p className="mt-1 text-[12.5px] font-semibold">{account.name}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{account.detail}</p>
                  </button>
                ))}
              </div>
              <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><LockKeyhole size={12} className="mt-0.5 shrink-0" />Pemilihan akun tetap diverifikasi server. Mode demo aktif hanya di lingkungan pengembangan.</p>
            </>
          ) : (
            <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><LockKeyhole size={12} className="mt-0.5 shrink-0" />Kata sandi demo tidak dikonfigurasi pada lingkungan ini. Hubungi admin untuk akses akun.</p>
          )}
        </motion.div>
      </section>
    </main>
  );
}
