"use client";
import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client";

/**
 * Ganti password sendiri. Dipakai di halaman Pengaturan agar setiap peran
 * (termasuk yang tidak punya `users.manage`) dapat mengganti passwordnya.
 *
 * Aturan yang ditampilkan sama dengan validasi server: minimal 12 karakter,
 * huruf besar + kecil + angka, dan wajib menyebut password lama. Sesi lain
 * dicabut otomatis setelah berhasil — itu disengaja, bukan bug yang perlu
 * dijelaskan belakangan.
 */
export default function AccountPasswordCard({ email, roleLabel }: { email: string; roleLabel: string }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const mismatch = form.confirm.length > 0 && form.confirm !== form.newPassword;
  const strong = form.newPassword.length >= 12 && /[a-z]/.test(form.newPassword) && /[A-Z]/.test(form.newPassword) && /\d/.test(form.newPassword);
  const canSubmit = !saving && form.currentPassword.length > 0 && strong && form.confirm === form.newPassword;

  const submit = async () => {
    setSaving(true); setError(""); setDone("");
    try {
      const result = await api<{ sessionsRevoked: number }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      setDone(result.sessionsRevoked > 0
        ? `Password diganti. ${result.sessionsRevoked} sesi lain dicabut; sesi ini tetap aktif.`
        : "Password diganti. Sesi ini tetap aktif.");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password gagal diganti.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold"><KeyRound size={16} />Password akun</h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
        Masuk sebagai <span className="font-semibold text-ink">{email}</span> · {roleLabel}.
        Ganti password secara berkala; password tidak pernah ditampilkan kembali oleh sistem.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Password saat ini" className="sm:col-span-2">
          <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field label="Password baru (min. 12 karakter)" hint={form.newPassword && !strong ? "Harus memuat huruf besar, huruf kecil, dan angka." : undefined}>
          <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Ulangi password baru" hint={mismatch ? "Belum sama dengan password baru." : undefined}>
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
      </div>

      {error ? <p className="mt-3 rounded-[var(--radius-control)] bg-danger-bg p-2.5 text-[11.5px] text-danger">{error}</p> : null}
      {done ? <p className="mt-3 rounded-[var(--radius-control)] bg-ok-bg p-2.5 text-[11.5px] text-ok">{done}</p> : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10.5px] text-subtle"><LogOut size={12} />Sesi lain otomatis dikeluarkan setelah password berubah.</p>
        <Button loading={saving} disabled={!canSubmit} onClick={() => void submit()}>Ganti password</Button>
      </div>
    </section>
  );
}
