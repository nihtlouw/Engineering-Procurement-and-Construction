/** Konstanta & tipe workflow S2a. Tidak ada logika bisnis di sini. */

export const BUDGET_TYPES = ["CLIENT", "INTERNAL"] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export const BUDGET_STATUSES = ["DRAFT", "REVIEW", "APPROVED", "BASELINE", "SUPERSEDED", "REJECTED"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_TRANSITIONS: Record<string, Record<string, string>> = {
  DRAFT: { SUBMIT: "REVIEW" },
  REVIEW: { APPROVE: "APPROVED", RETURN: "DRAFT", REJECT: "REJECTED" },
  APPROVED: { SET_BASELINE: "BASELINE" },
  BASELINE: {},
  SUPERSEDED: {},
  REJECTED: {},
};

export const VARIATION_TYPES = ["ADD", "OMIT", "SUBSTITUTE"] as const;
export type VariationType = (typeof VARIATION_TYPES)[number];

export const VARIATION_LINE_ACTIONS = ["ADD", "OMIT", "ADJUST"] as const;
export type VariationLineAction = (typeof VARIATION_LINE_ACTIONS)[number];

export const VARIATION_STATUSES = [
  "DRAFT", "INTERNAL_REVIEW", "AWAITING_CLIENT", "APPROVED", "IMPLEMENTED", "REJECTED", "CANCELLED",
] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];

/** CANCEL tersedia sampai APPROVED — menjawab gap "PTK tidak bisa dibatalkan". */
export const VARIATION_TRANSITIONS: Record<string, Record<string, string>> = {
  DRAFT: { SUBMIT: "INTERNAL_REVIEW", CANCEL: "CANCELLED" },
  INTERNAL_REVIEW: { SEND_CLIENT: "AWAITING_CLIENT", APPROVE: "APPROVED", REJECT: "REJECTED", CANCEL: "CANCELLED" },
  AWAITING_CLIENT: { APPROVE: "APPROVED", REJECT: "REJECTED", CANCEL: "CANCELLED" },
  APPROVED: { IMPLEMENT: "IMPLEMENTED", CANCEL: "CANCELLED" },
  IMPLEMENTED: {},
  REJECTED: {},
  CANCELLED: {},
};

export type BudgetLineInput = {
  code?: string | null;
  costCategoryId: string;
  description: string;
  quantity: string;
  unitCode: string;
  unitAmount: string;
  contingencyPct?: string | null;
  wbsItemId?: string | null;
  keywords?: string | null;
  sortOrder?: number;
};

export type VariationLineInput = {
  action: VariationLineAction;
  budgetType: BudgetType;
  budgetLineId?: string | null;
  description: string;
  quantity: string;
  unitCode: string;
  unitAmount: string;
  priceAmount: string;
  costAmount: string;
  sortOrder?: number;
};

export type PaguEvaluation = {
  pagu: string;
  used: string;
  ratioPct: number;
  tone: "ok" | "warn" | "danger";
  warning: string | null;
  blocked: boolean;
};
