// S1: CLIENT_VIEWER ditambahkan. Role OTORITATIF kini ada di memberships.company_role;
// users.role tetap dipertahankan sebagai fallback legacy untuk data seed.
export const ROLES = ["ADMIN", "ESTIMATOR", "PM", "FIELD", "PROCUREMENT", "FINANCE", "CLIENT_VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "portfolio.view", "opportunity.view", "opportunity.edit", "proposal.view", "proposal.edit", "proposal.approve",
  "budget.client.view", "budget.internal.view", "budget.edit", "budget.approve", "survey.view", "survey.edit",
  "design.view", "design.edit", "schedule.view", "schedule.edit", "progress.create", "expense.create",
  "expense.view.own", "expense.view.project", "expense.approve", "expense.void", "settlement.manage",
  "purchase.view", "purchase.edit", "invoice.view", "invoice.edit", "invoice.approve", "payment.record",
  "changeorder.edit", "changeorder.approve", "variation.edit", "variation.approve", "document.view", "document.upload", "template.manage",
  "gendoc.create", "gendoc.finalize", "project.close", "users.manage", "settings.manage", "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: all,
  ESTIMATOR: ["portfolio.view", "opportunity.view", "opportunity.edit", "proposal.view", "proposal.edit", "budget.client.view", "budget.edit", "variation.edit", "survey.view", "survey.edit", "design.view", "schedule.view", "expense.create", "expense.view.own", "document.view", "document.upload", "gendoc.create"],
  PM: ["portfolio.view", "opportunity.view", "opportunity.edit", "proposal.view", "proposal.approve", "budget.client.view", "budget.internal.view", "budget.edit", "budget.approve", "survey.view", "survey.edit", "design.view", "design.edit", "schedule.view", "schedule.edit", "progress.create", "expense.create", "expense.view.project", "expense.approve", "purchase.view", "purchase.edit", "invoice.view", "changeorder.edit", "changeorder.approve", "variation.edit", "variation.approve", "document.view", "document.upload", "gendoc.create", "gendoc.finalize", "project.close", "audit.view"],
  FIELD: ["schedule.view", "progress.create", "expense.create", "expense.view.own", "document.view", "document.upload"],
  PROCUREMENT: ["portfolio.view", "budget.client.view", "schedule.view", "progress.create", "expense.create", "expense.view.project", "purchase.view", "purchase.edit", "document.view", "document.upload"],
  FINANCE: ["portfolio.view", "budget.client.view", "budget.internal.view", "budget.approve", "variation.approve", "schedule.view", "expense.create", "expense.view.project", "expense.approve", "expense.void", "settlement.manage", "purchase.view", "invoice.view", "invoice.edit", "invoice.approve", "payment.record", "document.view", "document.upload", "gendoc.create", "gendoc.finalize", "project.close", "audit.view"],
  // Read-only untuk pihak klien. SENGaja tanpa budget.internal.view, expense.*,
  // invoice.*, audit.view, users.manage, dan seluruh aksi mutasi.
  CLIENT_VIEWER: ["portfolio.view", "budget.client.view", "schedule.view", "document.view"],
};

export const STAGES = ["AWAITING_KICKOFF", "PLANNING", "PROCUREMENT_MOBILIZATION", "IN_PROGRESS", "TESTING_COMMISSIONING", "HANDOVER", "WARRANTY_PERIOD", "CLOSING", "COMPLETED"] as const;
export const EXPENSE_TRANSITIONS: Record<string, Record<string, string>> = {
  DRAFT: { SUBMIT: "SUBMITTED" },
  SUBMITTED: { APPROVE: "APPROVED", RETURN: "NEEDS_CORRECTION", REJECT: "REJECTED" },
  NEEDS_CORRECTION: { SUBMIT: "SUBMITTED" },
  APPROVED: { VOID: "VOIDED" },
  REJECTED: {},
  VOIDED: {},
};
export const INVOICE_TRANSITIONS: Record<string, Record<string, string>> = {
  DRAFT: { APPROVE: "APPROVED_INTERNAL" },
  APPROVED_INTERNAL: { SEND: "SENT", CANCEL: "CANCELLED" },
  SENT: { CANCEL: "CANCELLED" },
  PARTIALLY_PAID: {},
  PAID: {},
  CANCELLED: {},
};

export const LABELS: Record<string, string> = {
  DRAFT: "Draft", SUBMITTED: "Menunggu Persetujuan", NEEDS_CORRECTION: "Perlu Perbaikan", REJECTED: "Ditolak",
  APPROVED: "Disetujui", APPROVED_INTERNAL: "Disetujui Internal", VOIDED: "Dibatalkan (Void)", PAID: "Lunas",
  PARTIALLY_PAID: "Sebagian Dibayar", OVERDUE: "Terlambat", SENT: "Terkirim", CANCELLED: "Dibatalkan",
  PENDING: "Menunggu Reimburse", PARTIAL: "Reimburse Sebagian", SETTLED: "Sudah Direimburse", NOT_APPLICABLE: "Dibayar Perusahaan",
  NOT_STARTED: "Belum Mulai", IN_PROGRESS: "Berjalan", DONE: "Selesai", BLOCKED: "Terhambat",
  AWAITING_KICKOFF: "Menunggu Kickoff", PLANNING: "Perencanaan", PROCUREMENT_MOBILIZATION: "Pengadaan & Mobilisasi",
  TESTING_COMMISSIONING: "Testing & Commissioning", HANDOVER: "Serah Terima", WARRANTY_PERIOD: "Masa Pemeliharaan",
  CLOSING: "Penutupan", COMPLETED: "Proyek Selesai", ON_HOLD: "Ditahan", NONE: "Normal",
  ORDERED: "Dipesan", REQUESTED: "Diminta", PARTIALLY_RECEIVED: "Diterima Sebagian", RECEIVED: "Diterima", CLOSED: "Ditutup",
  BASELINE: "Baseline Aktif", SUPERSEDED: "Digantikan", REVIEW: "Dalam Review", CLIENT: "RAB Klien", INTERNAL: "Anggaran Internal",
  FIELD_EXPENSE: "Biaya Lapangan", PO_BILL: "Tagihan PO", PROJECT: "Proyek", OVERHEAD: "Overhead",
  DP: "Uang Muka", MOS: "Material On Site", FAT: "FAT", PROGRESS: "Progres", FINAL: "Final", RETENTION: "Retensi", OTHER: "Lainnya",
  AWARDED: "Dimenangkan", LOST: "Kalah", QUALIFIED: "Terkualifikasi", ESTIMATING: "Estimasi", INTERNAL_REVIEW: "Review Internal",
  CLARIFICATION: "Klarifikasi", FINAL_DOC: "Final", ACTIVE: "Aktif", IMPLEMENTED: "Diimplementasikan", AWAITING_CLIENT: "Menunggu Klien",
  ADD: "Pekerjaan Tambah", OMIT: "Pekerjaan Kurang", SUBSTITUTE: "Substitusi", ADJUST: "Disesuaikan",
  OPEN: "Belum Ditagih", PARTIALLY_INVOICED: "Sebagian Ditagih", INVOICED: "Ditagih Penuh",
};

/**
 * Proyeksi aman untuk daftar pengguna. `companyId` opsional karena daftar user
 * bisa berisi identitas global yang belum tentu menjadi anggota company aktif.
 * Email SENGAJA tidak dikirim ke peran biasa (lihat getWorkspaceData).
 */
export type SafeUser = {
  id: string; name: string; email: string; role: Role; title: string; permissions: Permission[];
  companyId?: string; companyName?: string; companyRole?: Role;
};

/** Identitas hasil sesi: SELALU terikat tepat satu company aktif. */
export type SessionUser = SafeUser & {
  companyId: string; companyName: string; companyRole: Role;
};
export type ProjectMetric = {
  actualCost?: string; pendingCost?: string; commitment?: string; remainingCommitment?: string;
  contractValueCurrent?: string; forecastExposure?: string; invoiced?: string; received?: string;
  receivable?: string; overdue?: string; retentionOutstanding?: string; progressPct: number;
  baselineInternal?: string; remainingBudget?: string; indicativeMargin?: string;
};
export type CloseCheck = { key: string; label: string; ok: boolean; detail: string };

export type WorkspaceData = {
  generatedAt: string;
  user: SessionUser;
  companies: { id: string; name: string; slug: string }[];
  users: SafeUser[];
  settings: { id: string; legalName: string; displayName: string; npwp: string | null; address: string | null; phone: string | null; email: string | null; defaultPpnRate: string; allowSplitExpense: boolean };
  clients: Record<string, unknown>[];
  sites: Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  members: Record<string, unknown>[];
  categories: { id: string; code: string; name: string; isOverhead: boolean }[];
  units: { id: string; code: string; name: string }[];
  budgets: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  purchases: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  terms: Record<string, unknown>[];
  schedule: Record<string, unknown>[];
  progressUpdates: Record<string, unknown>[];
  changeOrders: Record<string, unknown>[];
  variationOrders: Record<string, unknown>[];
  punchItems: Record<string, unknown>[];
  handoverItems: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  metrics: Record<string, ProjectMetric>;
  closeChecks: Record<string, CloseCheck[]>;
};
