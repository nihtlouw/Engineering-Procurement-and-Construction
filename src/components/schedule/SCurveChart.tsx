"use client";
import type { SCurveCell } from "@/lib/client";

/* Kurva-S digambar sebagai SVG murni: tidak ada dependensi chart baru, tetap
 * tajam saat dicetak, dan aman di server component (menerima data siap pakai). */

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 40 };

const shortDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
};

export default function SCurveChart({ periods, height = H }: { periods: SCurveCell[]; height?: number }) {
  if (!periods.length) {
    return <p className="rounded-[var(--radius-control)] bg-paper p-4 text-xs text-muted">Belum ada periode untuk digambar. Isi tanggal mulai/selesai WBS terlebih dahulu.</p>;
  }
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const step = periods.length > 1 ? innerW / (periods.length - 1) : 0;
  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + innerH - (Math.max(0, Math.min(100, value)) / 100) * innerH;

  const plannedPoints = periods.map((period, index) => `${x(index)},${y(period.planned)}`).join(" ");
  const actualSeries = periods.map((period, index) => ({ index, value: period.actual })).filter((point) => point.value !== null);
  const actualPoints = actualSeries.map((point) => `${x(point.index)},${y(point.value as number)}`).join(" ");
  const areaPath = `M ${x(0)},${y(0)} L ${periods.map((period, index) => `${x(index)},${y(period.planned)}`).join(" L ")} L ${x(periods.length - 1)},${y(0)} Z`;
  // Tampilkan maksimal 8 label sumbu-X agar tidak padat.
  const labelEvery = Math.max(1, Math.ceil(periods.length / 8));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Kurva-S rencana versus aktual" className="w-full min-w-[560px]">
        <defs>
          <linearGradient id="scurve-plan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(198,242,78)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(198,242,78)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === 0 ? 0.35 : 0.12} strokeDasharray={tick === 0 ? undefined : "3 4"} />
            <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-current text-[9px] opacity-60">{tick}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#scurve-plan)" />
        <polyline points={plannedPoints} fill="none" stroke="rgb(101,163,13)" strokeWidth={2} strokeLinejoin="round" />
        {actualPoints ? <polyline points={actualPoints} fill="none" stroke="rgb(23,23,23)" strokeWidth={2.2} strokeLinejoin="round" /> : null}
        {actualSeries.map((point) => (
          <circle key={point.index} cx={x(point.index)} cy={y(point.value as number)} r={2.6} fill="rgb(23,23,23)" />
        ))}
        {periods.map((period, index) => (index % labelEvery === 0 || index === periods.length - 1
          ? <text key={period.periodStart} x={x(index)} y={height - 12} textAnchor="middle" className="fill-current text-[9px] opacity-60">{shortDate(period.periodStart)}</text>
          : null))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-[rgb(101,163,13)]" />Rencana</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-[rgb(23,23,23)]" />Aktual</span>
        <span>{periods.length} periode mingguan</span>
      </div>
    </div>
  );
}

/** Tabel pendamping (juga dipakai tombol ekspor/print). */
export function SCurveTable({ periods }: { periods: SCurveCell[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-line bg-paper-2 text-left">
            <th className="p-2 font-semibold">Periode (minggu)</th>
            <th className="p-2 text-right font-semibold">Rencana periode</th>
            <th className="p-2 text-right font-semibold">Rencana kumulatif</th>
            <th className="p-2 text-right font-semibold">Aktual kumulatif</th>
            <th className="p-2 text-right font-semibold">Deviasi</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => {
            const deviation = period.actual === null ? null : Math.round((period.actual - period.planned) * 100) / 100;
            return (
              <tr key={period.periodStart} className="border-b border-hairline">
                <td className="mono p-2">{period.periodStart}</td>
                <td className="p-2 text-right tabular">{period.plannedIncrement.toFixed(2)}%</td>
                <td className="p-2 text-right tabular">{period.planned.toFixed(2)}%</td>
                <td className="p-2 text-right tabular">{period.actual === null ? "—" : `${period.actual.toFixed(2)}%`}</td>
                <td className={`p-2 text-right tabular ${deviation === null ? "" : deviation < -0.5 ? "text-danger" : deviation > 0.5 ? "text-ok" : ""}`}>
                  {deviation === null ? "—" : `${deviation > 0 ? "+" : ""}${deviation.toFixed(2)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
