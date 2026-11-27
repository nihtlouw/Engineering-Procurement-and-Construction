/** Konstanta & tipe S2b. Tidak ada logika bisnis di sini. */

export const TERM_STATUSES = ["OPEN", "PARTIALLY_INVOICED", "INVOICED", "CLOSED"] as const;
export type TermStatus = (typeof TERM_STATUSES)[number];

/** Status PO tetap memakai transisi lama; RECEIVE ditambahkan sebagai aksi bertitel. */
export const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export type PoItemInput = {
  budgetLineId?: string | null;
  description: string;
  quantity: string;
  unitCode: string;
  unitAmount: string;
  sortOrder?: number;
};

export type NormalizedPoItem = PoItemInput & { dppAmount: string; sortOrder: number };

export type ReceiveItemInput = { itemId: string; receivedQty: string };

/**
 * Alasan sebuah PO tidak boleh dibatalkan (audit DOM-08 / S2b §7).
 * Komitmen PO hanya sah dikurangi lewat `PO_BILL` yang disetujui; membatalkan PO
 * yang sudah punya tagihan akan menghapus komitmen dari metrik tanpa jejak nilai.
 */
export const PO_CANCEL_BLOCK_STATUSES = ["DRAFT", "CANCELLED"] as const;

export type PoCancelGuardInput = {
  status: string;
  targetStatus: string;
  /** Tagihan PO (expense `type = PO_BILL`) yang tidak berstatus CANCELLED/VOIDED. */
  activeBillCount: number;
};

export type PoCancelGuardResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string; status: number };

export function evaluatePoCancelGuard(input: PoCancelGuardInput): PoCancelGuardResult {
  if (input.targetStatus !== "CANCELLED") return { allowed: true };
  if (input.activeBillCount > 0) {
    return {
      allowed: false,
      code: "PO_HAS_BILLS",
      status: 409,
      message:
        `PO tidak dapat dibatalkan: sudah ada ${input.activeBillCount} tagihan PO (PO_BILL) yang aktif. ` +
        "Batalkan/void tagihan tersebut lebih dulu agar komitmen tidak hilang dari metrik.",
    };
  }
  return { allowed: true };
}

export type TermLimitEvaluation = {
  termAmount: string;
  termUsed: string;
  termAfter: string;
  contractValue: string;
  projectUsed: string;
  projectAfter: string;
  overTerm: boolean;
  overContract: boolean;
  blocked: boolean;
};
