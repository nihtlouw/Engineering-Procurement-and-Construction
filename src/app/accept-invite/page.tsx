"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token] = useState(params.get("token") || "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setLoading(true); setError("");
    try {
      await api("/api/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, name, password }) });
      setDone(true);
      router.push("/"); router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undangan gagal diterima.");
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-5 py-10">
      <div className="w-full max-w-[400px] rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-e1)]">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-ok-bg text-ok"><LockKeyhole size={18} /></span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-[-.02em]">Terima undangan company</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Buat identitas Anda pada akun perusahaan. Data proyek akan terikat pada company, bukan akun pribadi.</p>

        {!token ? (
          <p role="alert" className="mt-5 rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">Tautan undangan tidak lengkap. Minta admin mengirim ulang tautan.</p>
        ) : done ? (
          <p className="mt-5 flex items-center gap-2 text-[12.5px] text-ok"><CheckCircle2 size={15} />Undangan diterima. Mengalihkan ke workspace…</p>
        ) : (
          <form className="mt-5 space-y-3.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label="Nama lengkap"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" /></Field>
            <Field label="Kata sandi" hint="Minimal 8 karakter. Jika email sudah terdaftar, gunakan password lama Anda."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
            {error ? <p role="alert" className="rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</p> : null}
            <Button type="submit" size="lg" loading={loading} className="w-full" disabled={!name.trim() || !password}>Masuk ke company</Button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-paper"><p className="text-[12.5px] text-muted">Menyiapkan formulir…</p></main>}><AcceptInviteForm /></Suspense>;
}
