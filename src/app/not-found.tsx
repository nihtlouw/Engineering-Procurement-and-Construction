import Link from "next/link";
import { Compass } from "lucide-react";

export default function AppNotFound() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-paper-2 text-muted"><Compass size={18} /></span>
        <h1 className="mt-4 text-[17px] font-semibold tracking-[-.02em]">Halaman tidak ditemukan</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Alamat ini tidak ada di ruang kerja Anda, atau modulnya di luar cakupan peran Anda.
        </p>
        <Link href="/" className="mt-4 inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-paper-2">
          Kembali ke ikhtisar
        </Link>
      </div>
    </div>
  );
}
