"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

/**
 * Halaman pembuatan password baru dari tautan email.
 *
 * Token diperiksa lebih dulu (GET, tanpa menghabiskannya) supaya pengguna tahu
 * tautannya kedaluwarsa/dipakai SEBELUM mengetik password. Semua kegagalan
 * dijelaskan apa adanya: tautan kedaluwarsa harus memicu permintaan baru, bukan
 * percobaan berulang yang membingungkan.
 */
function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  // Tanpa token tidak ada yang perlu diverifikasi: state awal langsung "invalid"
  // sehingga effect tidak perlu memanggil setState secara sinkron.
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">(token ? "checking" : "invalid");
  const [owner, setOwner] = useState("");
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    api<{ valid: boolean; name?: string; email?: string }>(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((result) => {
        if (!active) return;
        setOwner(result.email ? `${result.name} <${result.email}>` : "");
        setState(result.valid ? "ready" : "invalid");
      })
      .catch(() => { if (active) setState("invalid"); });
    return () => { active = false; };
  }, [token]);

  const strong = form.password.length >= 12 && /[a-z]/.test(form.password) && /[A-Z]/.test(form.password) && /\d/.test(form.password);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  const submit = async () => {
    setLoading(true); setError("");
    try {
      await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword: form.password }) });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password gagal diubah.");
    } finally {
      setLoading(false);
    }
  };

  const shell = (icon: React.ReactNode, title: string, body: React.ReactNode) => (
    <main className="grid min-h-dvh place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-[420px] rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-e1)]">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-ok-bg text-ok">{icon}</span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-[-.02em]">{title}</h1>
        {body}
        <Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-ink">
          <ArrowLeft size={14} />Kembali ke halaman masuk
        </Link>
      </div>
    </main>
  );

  if (state === "checking") return shell(<KeyRound size={18} />, "Memeriksa tautan…", <p className="mt-2 text-[12.5px] text-muted">Sebentar, tautan sedang diverifikasi.</p>);

  if (state === "invalid") return shell(<KeyRound size={18} />, "Tautan tidak berlaku", (
    <div className="mt-2 space-y-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Tautan reset sudah kedaluwarsa, sudah dipakai, atau dibatalkan karena ada permintaan baru. Minta tautan baru — tautan hanya berlaku 30 menit dan sekali pakai.
      </p>
      <Link href="/lupa-password" className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-ink px-3.5 text-[12px] font-semibold text-lime">Minta tautan baru</Link>
    </div>
  ));

  if (state === "done") return shell(<CheckCircle2 size={18} />, "Password berhasil diubah", (
    <div className="mt-2 space-y-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Semua sesi lama sudah dikeluarkan. Masuk kembali dengan password baru Anda.
      </p>
      <Link href="/" className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-ink px-3.5 text-[12px] font-semibold text-lime">Ke halaman masuk</Link>
    </div>
  ));

  return shell(<KeyRound size={18} />, "Buat password baru", (
    <form className="mt-2 space-y-3.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {owner ? <p className="text-[12px] text-muted">Akun: <span className="font-semibold text-ink">{owner}</span></p> : null}
      <Field label="Password baru (min. 12 karakter)" hint={form.password && !strong ? "Harus memuat huruf besar, huruf kecil, dan angka." : undefined}>
        <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      </Field>
      <Field label="Ulangi password baru" hint={mismatch ? "Belum sama dengan password baru." : undefined}>
        <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
      </Field>
      {error ? <p role="alert" className="rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!strong || form.confirm !== form.password}>Simpan password baru</Button>
    </form>
  ));
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-paper"><p className="text-[12.5px] text-muted">Menyiapkan formulir…</p></main>}><ResetPasswordForm /></Suspense>;
}
