"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck, Send } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

/**
 * Halaman permintaan tautan reset. Respons server sengaja tidak membedakan
 * email terdaftar dan tidak terdaftar — halaman ini menampilkan pesan yang sama
 * untuk keduanya, dan hanya menampilkan tautan debug saat server melaporkannya
 * (driver email `console` di development).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [debugLink, setDebugLink] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true); setError(""); setDebugLink("");
    try {
      const result = await api<{ message: string; debugLink?: string; reason?: string }>("/api/auth/forgot-password", {
        method: "POST", body: JSON.stringify({ email }),
      });
      setSent(true);
      if (result.debugLink) setDebugLink(result.debugLink);
      if (result.reason === "APP_BASE_URL_MISSING") setError("Server belum mengatur APP_BASE_URL, sehingga tautan tidak dapat dibuat. Hubungi admin.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permintaan gagal dikirim.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-[420px] rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-e1)]">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-ok-bg text-ok"><MailCheck size={18} /></span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-[-.02em]">Lupa password?</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Masukkan email akun Anda. Kami kirim tautan sekali pakai untuk membuat password baru — password lama tidak pernah ditampilkan.
        </p>

        {sent ? (
          <div className="mt-5 space-y-3">
            <p className="rounded-[var(--radius-control)] border border-ok-line bg-ok-bg px-3 py-2.5 text-[12px] leading-relaxed text-ok">
              Bila email <span className="font-semibold">{email}</span> terdaftar, tautan pengaturan password sudah dikirim. Periksa kotak masuk dan folder spam; tautan berlaku 30 menit.
            </p>
            {debugLink ? (
              <div className="rounded-[var(--radius-control)] border border-warn-line bg-warn-bg px-3 py-2.5 text-[11.5px] text-warn">
                <p className="font-semibold">Mode pengembangan (email tidak benar-benar dikirim)</p>
                <a href={debugLink} className="mt-1 block break-all underline">{debugLink}</a>
              </div>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => { setSent(false); setDebugLink(""); }}>Kirim ke email lain</Button>
          </div>
        ) : (
          <form className="mt-5 space-y-3.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label="Email akun">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="nama@perusahaan.co.id" />
            </Field>
            {error ? <p role="alert" className="rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!email.trim()}><Send size={15} />Kirim tautan reset</Button>
          </form>
        )}

        <Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink">
          <ArrowLeft size={14} />Kembali ke halaman masuk
        </Link>
      </div>
    </main>
  );
}
