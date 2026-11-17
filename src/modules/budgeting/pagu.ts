import Decimal from "decimal.js";
import { D, money } from "@/lib/format";
import type { PaguEvaluation } from "@/modules/budgeting/types";

/** Total pos RAB = volume × harga satuan, dibulatkan 2 desimal (tanpa float). */
export function lineTotal(quantity: string, unitAmount: string) {
  return money(D(quantity).times(unitAmount));
}

/** Pagu = nilai pos + kontingensi (contingencyPct akhirnya terpakai, audit B3). */
export function paguAmount(total: string, contingencyPct: string | null | undefined) {
  return money(D(total).times(D(1).plus(D(contingencyPct ?? 0).div(100))));
}

/**
 * Ambang pagu: >90% warning, >100% blocked kecuali ada alasan + izin approve.
 * `actual` = biaya APPROVED, `pending` = SUBMITTED/NEEDS_CORRECTION,
 * `committed` = PO ORDERED/RECEIVED yang belum tertagih, `incoming` = transaksi baru.
 */
export function evaluatePagu(input: {
  total: string; contingencyPct?: string | null;
  actual?: string; pending?: string; committed?: string; incoming?: string;
}): PaguEvaluation {
  const pagu = D(paguAmount(input.total, input.contingencyPct));
  const used = D(input.actual ?? 0).plus(input.pending ?? 0).plus(input.committed ?? 0).plus(input.incoming ?? 0);
  const ratioPct = pagu.gt(0) ? used.div(pagu).times(100).toNumber() : used.gt(0) ? Infinity : 0;
  const blocked = ratioPct > 100;
  const tone = blocked ? "danger" : ratioPct > 90 ? "warn" : "ok";
  return {
    pagu: money(pagu), used: money(used), ratioPct, tone, blocked,
    warning: blocked
      ? `Pagu terlampaui (${ratioPct.toFixed(0)}% dari ${money(pagu)}).`
      : ratioPct > 90 ? `Mendekati pagu (${ratioPct.toFixed(0)}% dari ${money(pagu)}).` : null,
  };
}

export function sumAmounts(values: (string | null | undefined)[]) {
  return money(values.reduce((acc, v) => acc.plus(v ?? 0), D(0)));
}

export type { Decimal };
