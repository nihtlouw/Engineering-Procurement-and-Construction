"use client";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Lock, LockOpen, Mail, RefreshCw, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/client";
import { ROLES, type Role } from "@/lib/domain";
import { Badge, Button, EmptyState, Field, Input, Modal, SectionTitle, Select, TableSkeleton } from "@/components/ui";
import type { InviteResult, MemberView, PendingInviteView } from "@/modules/companies/types";

/** Label peran yang dipakai di UI manajemen pengguna. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin Perusahaan", ESTIMATOR: "Estimator", PM: "Project Manager",
  FIELD: "Staff Lapangan", PROCUREMENT: "Procurement", FINANCE: "Finance",
  CLIENT_VIEWER: "Client Viewer",
};

type UsersResponse = { members: MemberView[]; pending: PendingInviteView[]; company: { id: string; name: string } };

export default function UserManagement({ onSaved }: { onSaved: (message: string) => void }) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [pending, setPending] = useState<PendingInviteView[]>([]);
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("FIELD");
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [resetFor, setResetFor] = useState<MemberView | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetDone, setResetDone] = useState<{ name: string; password: string } | null>(null);

  const load = async () => {
    try {
      const result = await api<UsersResponse>("/api/users");
      setMembers(result.members); setPending(result.pending); setCompany(result.company.name);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Data pengguna gagal dimuat.");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() async; setState terjadi setelah await fetch
  useEffect(() => { void load(); }, []);

  const sendInvite = async () => {
    setSaving(true); setError(""); setInvite(null);
    try {
      const result = await api<InviteResult>("/api/users/invite", {
        method: "POST", body: JSON.stringify({ email, companyRole: role }),
      });
      setInvite(result); setEmail("");
      onSaved(`Undangan untuk ${result.email} dibuat.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undangan gagal dibuat.");
    } finally {
      setSaving(false);
    }
  };

  const changeMember = async (userId: string, patch: { companyRole?: Role; status?: "ACTIVE" | "SUSPENDED" }) => {
    setError("");
    try {
      await api(`/api/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(patch) });
      onSaved("Peran/status anggota diperbarui dan dicatat di audit.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Perubahan gagal disimpan.");
      await load();
    }
  };

  /* Reset password: password baru diketik admin, lalu ditampilkan sekali agar
     dapat diserahkan ke pengguna. Server tidak pernah mengembalikan password. */
  const submitReset = async () => {
    if (!resetFor) return;
    setResetSaving(true); setError("");
    try {
      await api(`/api/users/${encodeURIComponent(resetFor.userId)}/password`, {
        method: "POST", body: JSON.stringify({ newPassword: resetPassword }),
      });
      setResetDone({ name: resetFor.name, password: resetPassword });
      onSaved(`Password ${resetFor.name} direset; semua sesinya dicabut dan kunci login dibuka.`);
      setResetFor(null); setResetPassword("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset password gagal.");
    } finally {
      setResetSaving(false);
    }
  };

  /* Kirim tautan reset ke email anggota: admin tidak perlu tahu/mengetik
     password siapa pun. Tautan hanya ada di email pengguna. */
  const sendResetLink = async (member: MemberView) => {
    setError("");
    try {
      const result = await api<{ delivered: boolean; email: string; reason?: string; debugLink?: string }>(
        `/api/users/${encodeURIComponent(member.userId)}/reset-link`, { method: "POST", body: JSON.stringify({}) },
      );
      if (result.delivered) onSaved(`Tautan reset dikirim ke ${result.email}.`);
      else if (result.debugLink) { setResetDone({ name: `${member.name} (tautan pengembangan)`, password: result.debugLink }); }
      else setError(`Tautan belum terkirim: ${result.reason ?? "email belum dikonfigurasi"}. Gunakan Reset password manual.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim tautan reset.");
    }
  };

  const unlock = async (userId: string) => {
    setError("");
    try {
      await api(`/api/users/${encodeURIComponent(userId)}/action`, { method: "POST", body: JSON.stringify({ action: "UNLOCK" }) });
      onSaved("Kunci login dibuka; penghitung kegagalan direset ke 0.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuka kunci login.");
    }
  };

  return (
    <div>
      <SectionTitle
        eyebrow="Akun perusahaan" title="Pengguna & peran"
        description={`Data berada di akun company${company ? ` ${company}` : ""}, bukan akun pribadi. Setiap user masuk lewat keanggotaan company; peran menentukan izin dan RAB internal.`}
        action={<Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw size={14} />Muat ulang</Button>}
      />

      {resetDone ? (
        <div className="mb-4 rounded-[var(--radius-control)] border border-ok-line bg-ok-bg px-3 py-2.5 text-[12px]">
          <p className="font-semibold text-ok">{resetDone.name.startsWith("Password") ? resetDone.name : `Password ${resetDone.name} sudah direset`}</p>
          <p className="mt-1 text-muted">Serahkan nilai ini lewat kanal aman, lalu minta pengguna menggantinya di menu akun. Nilai tidak ditampilkan lagi setelah Anda menutup pesan ini.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="mono rounded bg-surface px-2 py-1.5 text-[11.5px]">{resetDone.password}</code>
            <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(resetDone.password)}><Copy size={13} />Salin</Button>
            <Button variant="ghost" size="sm" onClick={() => setResetDone(null)}>Tutup</Button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="mb-4 rounded-[var(--radius-control)] border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{error}</p> : null}

      <section className="mb-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <h2 className="text-[13px] font-semibold">Undang anggota baru</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Token undangan ditampilkan sekali. Kirimkan lewat kanal aman; pengiriman email belum diaktifkan pada MVP 1.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <Field label="Email calon anggota"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.co.id" /></Field>
          <Field label="Peran"><Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          <Button loading={saving} onClick={() => void sendInvite()} disabled={!email.trim()}><UserPlus size={15} />Buat undangan</Button>
        </div>
        {invite ? (
          <div className="mt-4 rounded-[var(--radius-control)] border border-line bg-ok-bg p-3">
            <p className="text-[12px] font-semibold text-ok">Undangan aktif sampai {new Date(invite.expiresAt).toLocaleString("id-ID")}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Tautan penerimaan (rahasia, jangan dibagikan ke orang lain):</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="mono min-w-0 flex-1 break-all rounded bg-surface px-2 py-1.5 text-[11px]">{invite.acceptPath}</code>
              <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${invite.acceptPath}`)}><Copy size={13} />Salin tautan</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">Anggota company</h2>
          <span className="text-[11px] text-muted">{members.length} akun</span>
        </div>
        {loading ? <TableSkeleton rows={4} cols={4} /> : members.length === 0 ? (
          <EmptyState icon={<Users size={18} />} title="Belum ada anggota" description="Buat undangan pertama untuk mulai bekerja dalam akun company ini." />
        ) : (
          <div className="divide-y divide-hairline">
            {members.map((m) => (
              <div key={m.membershipId} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_200px_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold">{m.name}</p>
                  <p className="truncate text-[11px] text-muted">{m.email} · {m.title}</p>
                </div>
                <Select aria-label={`Peran ${m.name}`} value={m.companyRole} onChange={(e) => void changeMember(m.userId, { companyRole: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge value={m.status} label={m.status === "ACTIVE" ? "Aktif" : "Nonaktif"} />
                  {m.lockedUntil ? (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 py-1 text-[10.5px] font-semibold text-warn"><Lock size={11} />Terkunci s/d {new Date(m.lockedUntil).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                      <Button variant="secondary" size="sm" onClick={() => void unlock(m.userId)}><LockOpen size={13} />Buka kunci</Button>
                    </>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => void sendResetLink(m)}>
                    <Mail size={13} />Kirim tautan
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setResetFor(m); setResetPassword(""); }}>
                    <KeyRound size={13} />Reset manual
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void changeMember(m.userId, { status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>
                    {m.status === "ACTIVE" ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pending.length ? (
        <section className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <h2 className="text-[13px] font-semibold">Riwayat undangan</h2>
          <ul className="mt-2 space-y-1.5">
            {pending.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
                <span>{p.email} · {ROLE_LABELS[p.companyRole]}</span>
                <span>{p.accepted ? "Diterima" : p.revoked ? "Dicabut" : new Date(p.expiresAt) < new Date() ? "Kedaluwarsa" : "Menunggu"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
