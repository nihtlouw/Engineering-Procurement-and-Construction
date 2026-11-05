"use client";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

/* Batas galat untuk cakupan halaman aplikasi.
   Pesan menenangkan, dua jalan keluar yang jelas, dan kode galat untuk dilaporkan ke admin. */

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-danger-line bg-surface p-6 shadow-[var(--shadow-e1)]">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-danger-bg text-danger"><AlertTriangle size={18} /></span>
        <h1 className="mt-4 text-[17px] font-semibold tracking-[-.02em]">Data gagal dimuat</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Koneksi ke server terputus atau permintaan ditolak. Tidak ada data yang berubah, dan perubahan yang sudah tersimpan tetap aman.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={reset} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-ink bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink-700">
            <RotateCcw size={13} />Coba lagi
          </button>
          <button onClick={() => window.location.reload()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-paper-2">
            <RefreshCw size={13} />Muat ulang halaman
          </button>
        </div>
        {error.digest ? (
          <p className="mt-4 border-t border-hairline pt-3 text-[11px] text-muted">
            Kode kejadian: <span className="mono text-ink">{error.digest}</span> · sampaikan kode ini ke admin bila berulang.
          </p>
        ) : null}
      </div>
    </div>
  );
}
