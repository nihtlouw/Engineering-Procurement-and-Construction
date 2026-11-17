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
