/* -------------------------------------------------------------------------- */
/* S5 · WBS & kurva-S — logika murni (tanpa DB, mudah diuji)                  */
/* -------------------------------------------------------------------------- */

export const WBS_LEVELS = [1, 2, 3, 4] as const;
export const WBS_MAX_ITEMS = 300;
/** Σ bobot aktivitas harus 100% dengan toleransi pembulatan. */
export const WEIGHT_TOLERANCE = 0.0001;
/** Periode kurva-S = minggu kalender (Senin–Minggu). */
export const PERIOD_DAYS = 7;

export const WBS_ITEM_TYPES = ["SUMMARY", "WORK_PACKAGE", "ACTIVITY", "MILESTONE"] as const;

export type WbsItemLike = {
  id: string;
  parentId: string | null;
  level: number;
  weight: string;
  progressPct: string;
  isSummary: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  sortOrder: number;
  code?: string | null;
  name?: string;
};

export type WeightSummary = {
  /** Jumlah bobot seluruh item (semua level). */
  totalWeight: number;
  /** Jumlah bobot item yang dihitung sebagai aktivitas (bukan ringkasan). */
  activityWeight: number;
  activityCount: number;
  summaryCount: number;
  /** % progres terbobot seluruh aktivitas. */
  weightedProgress: number;
  /** Peringatan bila Σ bobot aktivitas ≠ 100%. */
  warning: string | null;
};

const toNumber = (value: string | number | null | undefined) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Bobot progres = Σ(bobot × progres) / Σ bobot. Item ringkasan (`isSummary`)
 * tidak dihitung karena bobotnya adalah agregat anak-anaknya — menghitungnya
 * akan menduplikasi kontribusi yang sama.
 */
export function summarizeWeights(items: WbsItemLike[]): WeightSummary {
  const activities = items.filter((item) => !item.isSummary);
  const totalWeight = round(items.reduce((sum, item) => sum + toNumber(item.weight), 0));
  const activityWeight = round(activities.reduce((sum, item) => sum + toNumber(item.weight), 0));
  const weighted = activities.reduce((sum, item) => sum + toNumber(item.weight) * toNumber(item.progressPct), 0);
  const weightedProgress = activityWeight > 0 ? round(weighted / activityWeight, 2) : 0;
  let warning: string | null = null;
  if (activities.length && Math.abs(activityWeight - 100) > WEIGHT_TOLERANCE) {
    warning = `Total bobot aktivitas ${round(activityWeight, 2)}% — seharusnya tepat 100%.`;
  }
  if (!activities.length) warning = "Belum ada aktivitas ber-bobot; kurva-S tidak dapat dihitung.";
  return {
    totalWeight, activityWeight, activityCount: activities.length,
    summaryCount: items.length - activities.length, weightedProgress, warning,
  };
}

/** Saran bobot merata (mis. 4 aktivitas → 25,00 tiap baris) yang pasti Σ 100. */
export function evenWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((10000 / count)) / 100;
  const weights = Array.from({ length: count }, () => base);
  const remainder = round(100 - base * count, 2);
  weights[count - 1] = round(weights[count - 1] + remainder, 2);
  return weights;
}

/**
 * Perbaiki selisih pembulatan agar Σ = 100. Selisih selalu diterapkan ke baris
 * TERAKHIR agar hasilnya dapat diprediksi dan sama dengan `evenWeights()`.
 */
export function normalizeWeights(weights: number[]): number[] {
  if (!weights.length) return [];
  const total = round(weights.reduce((sum, weight) => sum + weight, 0), 2);
  if (Math.abs(total - 100) <= WEIGHT_TOLERANCE) return weights.map((weight) => round(weight, 2));
  const next = weights.map((weight) => round(weight, 2));
  next[next.length - 1] = round(next[next.length - 1] + (100 - total), 2);
  return next;
}

/** Senin dari minggu yang memuat tanggal tersebut (ISO week start). */
export function weekStart(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date(value);
  const day = date.getUTCDay(); // 0 = Minggu
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type PeriodCell = {
  periodStart: string;
  /** Rencana kumulatif (%) sampai akhir periode. */
  planned: number;
  /** Aktual kumulatif (%) dari progres terbobot per periode. */
  actual: number | null;
  /** Rencana periode ini saja (%). */
  plannedIncrement: number;
};

export type SCurve = {
  periods: PeriodCell[];
  plannedTotal: number;
  actualTotal: number;
  /** Deviasi akhir (aktual − rencana) dalam poin persen. */
  deviation: number;
  /** Status jadwal sederhana untuk badge UI. */
  status: "AHEAD" | "ON_TRACK" | "BEHIND" | "NO_DATA";
  warning: string | null;
};

/**
 * Kurva-S rencana dari tanggal rencana tiap aktivitas (distribusi linier antar
 * `plannedStart` → `plannedEnd`, dikali bobot). Aktual diambil dari
 * `progress_updates` per periode bila tersedia; bila kosong, aktual = null.
 */
export function buildSCurve(input: {
  items: WbsItemLike[];
  startDate: string;
  endDate: string;
  actualByPeriod?: Record<string, number>;
}): SCurve {
  const { items, startDate, endDate } = input;
  const activities = items.filter((item) => !item.isSummary);
  const summary = summarizeWeights(items);
  const first = weekStart(startDate);
  const last = weekStart(endDate);
  if (last < first) {
    return {
      periods: [], plannedTotal: 0, actualTotal: 0, deviation: 0,
      status: "NO_DATA", warning: "Tanggal selesai lebih awal dari tanggal mulai.",
    };
  }
  const periods: PeriodCell[] = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, PERIOD_DAYS)) {
    periods.push({ periodStart: cursor, planned: 0, actual: null, plannedIncrement: 0 });
  }
  const periodIndex = (date: string) => {
    const start = weekStart(date);
    const diff = Math.floor((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    return Math.floor(diff / PERIOD_DAYS);
  };

  for (const item of activities) {
    const weight = toNumber(item.weight);
    if (!weight) continue;
    const from = item.plannedStart ? periodIndex(item.plannedStart) : 0;
    const to = item.plannedEnd ? periodIndex(item.plannedEnd) : periods.length - 1;
    const start = Math.max(0, Math.min(from, periods.length - 1));
    const finish = Math.max(start, Math.min(to, periods.length - 1));
    const span = finish - start + 1;
    const increment = weight / span;
    for (let index = start; index <= finish; index += 1) {
      periods[index].plannedIncrement = round(periods[index].plannedIncrement + increment, 4);
    }
  }

  let cumulativePlan = 0;
  periods.forEach((period) => {
    cumulativePlan = round(cumulativePlan + period.plannedIncrement, 4);
    period.planned = round(Math.min(cumulativePlan, 100), 2);
  });

  const actualByPeriod = input.actualByPeriod ?? {};
  // Minggu tanpa laporan di TENGAH kurva memakai nilai terakhir (carry-forward),
  // tetapi minggu setelah laporan terakhir tetap null — bukan 0 dan bukan
  // proyeksi, supaya deviasi tidak menyesatkan.
  const reportedUntil = periods.reduce((lastIndex, period, index) =>
    (actualByPeriod[period.periodStart] !== undefined ? index : lastIndex), -1);
  let cumulativeActual = 0;
  periods.forEach((period, index) => {
    const increment = actualByPeriod[period.periodStart];
    if (increment !== undefined) cumulativeActual = round(cumulativeActual + increment, 4);
    period.actual = index <= reportedUntil ? round(Math.min(cumulativeActual, 100), 2) : null;
  });

  const plannedTotal = periods.length ? periods[periods.length - 1].planned : 0;
  const actualTotal = reportedUntil >= 0 ? periods[reportedUntil].actual ?? 0 : 0;
  const deviation = round(actualTotal - (reportedUntil >= 0 ? periods[reportedUntil].planned : 0), 2);
  const status = reportedUntil < 0
    ? "NO_DATA"
    : deviation >= 0.5 ? "AHEAD" : deviation <= -0.5 ? "BEHIND" : "ON_TRACK";
  return { periods, plannedTotal, actualTotal, deviation, status, warning: summary.warning };
}

/**
 * Aktual per periode dari update progres. Update hanya mencatat progres
 * kumulatif item, jadi delta dihitung berurutan per item lalu dikalikan bobot.
 */
export function actualIncrementByPeriod(
  items: WbsItemLike[],
  updates: { scheduleItemId: string; reportDate: string; progressPct: string | null }[],
): Record<string, number> {
  const weightById = new Map(items.filter((item) => !item.isSummary).map((item) => [item.id, toNumber(item.weight)]));
  const byItem = new Map<string, { date: string; pct: number }[]>();
  for (const update of updates) {
    if (!weightById.has(update.scheduleItemId)) continue;
    const list = byItem.get(update.scheduleItemId) ?? [];
    list.push({ date: update.reportDate.slice(0, 10), pct: toNumber(update.progressPct) });
    byItem.set(update.scheduleItemId, list);
  }
  const result: Record<string, number> = {};
  for (const [itemId, list] of byItem) {
    const weight = weightById.get(itemId) ?? 0;
    let previous = 0;
    for (const entry of list.sort((a, b) => a.date.localeCompare(b.date))) {
      const delta = Math.max(0, entry.pct - previous);
      if (delta > 0 && weight > 0) {
        const key = weekStart(entry.date);
        result[key] = round((result[key] ?? 0) + (weight * delta) / 100, 4);
      }
      previous = Math.max(previous, entry.pct);
    }
  }
  return result;
}

/** Ringkasan deviasi jadwal untuk kartu dashboard/workspace. */
export function scheduleVerdict(deviation: number) {
  if (deviation >= 0.5) return { status: "AHEAD" as const, label: "Lebih cepat" };
  if (deviation <= -0.5) return { status: "BEHIND" as const, label: "Terlambat" };
  return { status: "ON_TRACK" as const, label: "Sesuai rencana" };
}

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
