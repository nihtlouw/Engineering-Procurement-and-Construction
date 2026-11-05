"use client";
import { LoaderCircle } from "lucide-react";

/* Keadaan memuat dan galat untuk cakupan halaman aplikasi (rencana desain v1: empat keadaan data).
   Skeleton mengikuti bentuk konten (KPI strip + tabel), bukan spinner di tengah layar. */

export default function Loading() {
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="skeleton h-[26px] w-56" />
          <div className="skeleton mt-2 h-[13px] w-40" />
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-8 w-[110px]" />
          <div className="skeleton h-8 w-[100px]" />
        </div>
      </div>

      <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-b border-hairline p-4 last:border-b-0 sm:border-r xl:border-b-0">
            <div className="skeleton h-[12px] w-24" />
            <div className="skeleton mt-2.5 h-[25px] w-32" />
            <div className="skeleton mt-2.5 h-[11px] w-28" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        {[0, 1].map((panel) => (
          <div key={panel} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="skeleton h-[13px] w-28" />
              <div className="skeleton h-[11px] w-16" />
            </div>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
                <div className="skeleton h-7 w-7 shrink-0" />
                <div className="flex-1">
                  <div className="skeleton h-[12px] w-3/5" />
                  <div className="skeleton mt-1.5 h-[11px] w-4/5" />
                </div>
                <div className="skeleton h-6 w-20 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-2 text-[11.5px] text-muted" role="status" aria-live="polite">
        <LoaderCircle size={13} className="animate-spin" />
        Memuat data workspace...
      </p>
    </div>
  );
}
