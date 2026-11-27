import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const money = (name: string) => numeric(name, { precision: 18, scale: 2 }).notNull().default("0");
const quantity = (name: string) => numeric(name, { precision: 18, scale: 4 }).notNull().default("0");
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  title: text("title").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  companyId: uuid("company_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const companySettings = pgTable("company_settings", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  npwp: text("npwp"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  baseCurrency: text("base_currency").notNull().default("IDR"),
  defaultPpnRate: numeric("default_ppn_rate", { precision: 5, scale: 2 }).notNull().default("11"),
  allowSplitExpense: boolean("allow_split_expense").notNull().default(false),
  requireSeparationOfDuty: boolean("require_separation_of_duty").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable("clients", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  // 0006: unik PER COMPANY, bukan global.
  code: text("code").notNull(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  industry: text("industry").notNull(),
  npwp: text("npwp"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("clients_company_code_idx").on(table.companyId, table.code)]);

export const sites = pgTable("sites", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  clientId: text("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  address: text("address"),
  contact: text("contact"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
});

export const opportunities = pgTable("opportunities", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  code: text("code").notNull(),
  title: text("title").notNull(),
  clientId: text("client_id").notNull().references(() => clients.id),
  siteId: text("site_id").references(() => sites.id),
  requirement: text("requirement"),
  ownerId: text("owner_id").notNull().references(() => users.id),
  dueDate: date("due_date"),
  estimatedValue: money("estimated_value"),
  status: text("status").notNull().default("DRAFT"),
  outcomeReason: text("outcome_reason"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("opportunities_company_code_idx").on(table.companyId, table.code)]);

export const projects = pgTable("projects", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  code: text("code").notNull(),
  title: text("title").notNull(),
  clientId: text("client_id").notNull().references(() => clients.id),
  siteId: text("site_id").references(() => sites.id),
  opportunityId: text("opportunity_id").unique(),
  pmId: text("pm_id").references(() => users.id),
  stage: text("stage").notNull().default("AWAITING_KICKOFF"),
  hold: text("hold").notNull().default("NONE"),
  contractNumber: text("contract_number"),
  contractDate: date("contract_date"),
  contractValue: money("contract_value"),
  /** S2a: SATU sumber nilai kontrak berjalan = contractValue + CO/PTK approved. Dijaga trigger DB. */
  contractValueCurrent: money("contract_value_current"),
  contractPpn: money("contract_ppn"),
  retentionPct: numeric("retention_pct", { precision: 5, scale: 2 }).notNull().default("5"),
  warrantyMonths: integer("warranty_months").notNull().default(12),
  startDate: date("start_date"),
  targetEndDate: date("target_end_date"),
  bast1Date: date("bast1_date"),
  bast2Date: date("bast2_date"),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("projects_company_code_idx").on(table.companyId, table.code)]);

export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectRole: text("project_role").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
  },
  (table) => [uniqueIndex("project_member_unique").on(table.projectId, table.userId, table.projectRole)],
);

export const costCategories = pgTable("cost_categories", {
  id: id(),
  companyId: uuid("company_id"),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isOverhead: boolean("is_overhead").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const units = pgTable("units", {
  id: id(),
  companyId: uuid("company_id"),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const budgetVersions = pgTable(
  "budget_versions",
  {
    id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("DRAFT"),
    isActiveBaseline: boolean("is_active_baseline").notNull().default(false),
    changeOrderId: text("change_order_id"),
    total: money("total"),
    approvedById: text("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdById: text("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    // S2a: revisi & immutability baseline
    revisionNote: text("revision_note"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    supersededBy: text("superseded_by"),
    sourceVariationId: text("source_variation_id"),
    createdFromVersionId: text("created_from_version_id"),
  },
  (table) => [uniqueIndex("budget_version_unique").on(table.projectId, table.type, table.versionNo)],
);

export const budgetLines = pgTable("budget_lines", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  budgetVersionId: text("budget_version_id").notNull().references(() => budgetVersions.id, { onDelete: "cascade" }),
  costCategoryId: text("cost_category_id").notNull().references(() => costCategories.id),
  code: text("code"),
  description: text("description").notNull(),
  quantity: quantity("quantity"),
  unitCode: text("unit_code").notNull(),
  unitAmount: money("unit_amount"),
  total: money("total"),
  contingencyPct: numeric("contingency_pct", { precision: 5, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  // S2a: status pos (ACTIVE/OMITTED), asal PTK, hook WBS (S5) & Price Reference (S6).
  // Kolom turunan computed_total/contingency_amount/pagu_amount ADA di DB tetapi
  // sengaja tidak dipetakan Drizzle agar kloning baris lama tidak menulis kolom generated.
  lineStatus: text("line_status").notNull().default("ACTIVE"),
  variationAction: text("variation_action"),
  sourceVariationId: text("source_variation_id"),
  wbsItemId: text("wbs_item_id"),
  keywords: text("keywords"),
});

export const contractTerms = pgTable("contract_terms", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  percent: numeric("percent", { precision: 5, scale: 2 }),
  amount: money("amount"),
  trigger: text("trigger"),
  targetDate: date("target_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  // S2b: kumulatif tagihan per termin (dijaga trigger DB, audit B5).
  invoicedAmount: money("invoiced_amount"),
  status: text("status").notNull().default("OPEN"),
  isAutoAmount: boolean("is_auto_amount").notNull().default(true),
});

export const purchaseRecords = pgTable("purchase_records", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierName: text("supplier_name").notNull(),
  poNumber: text("po_number"),
  status: text("status").notNull().default("DRAFT"),
  summary: text("summary").notNull(),
  dppAmount: money("dpp_amount"),
  ppnAmount: money("ppn_amount"),
  totalAmount: money("total_amount"),
  orderDate: date("order_date"),
  expectedDate: date("expected_date"),
  budgetLineId: text("budget_line_id").references(() => budgetLines.id),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const fileObjects = pgTable("file_objects", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  // S3: NULL untuk file baru yang tersimpan di LOCAL/S3, bukan base64 di DB.
  contentBase64: text("content_base64"),
  storageProvider: text("storage_provider").notNull().default("DB"),
  storageBucket: text("storage_bucket"),
  width: integer("width"),
  height: integer("height"),
  originalSizeBytes: integer("original_size_bytes"),
  uploadedById: text("uploaded_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const expenses = pgTable("expenses", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  code: text("code").notNull().unique(),
  type: text("type").notNull().default("FIELD_EXPENSE"),
  defaultScope: text("default_scope").notNull().default("PROJECT"),
  defaultProjectId: text("default_project_id").references(() => projects.id),
  isSplit: boolean("is_split").notNull().default(false),
  isPreBaseline: boolean("is_pre_baseline").notNull().default(false),
  purchaseRecordId: text("purchase_record_id").references(() => purchaseRecords.id),
  merchantName: text("merchant_name"),
  receiptNumber: text("receipt_number"),
  transactionDate: date("transaction_date").notNull(),
  originalCurrency: text("original_currency").notNull().default("IDR"),
  originalAmount: money("original_amount"),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
  subtotal: money("subtotal"),
  discountAmount: money("discount_amount"),
  dppAmount: money("dpp_amount"),
  ppnAmount: money("ppn_amount"),
  totalAmount: money("total_amount"),
  mismatchReason: text("mismatch_reason"),
  duplicateReason: text("duplicate_reason"),
  paymentMethod: text("payment_method").notNull(),
  paidByType: text("paid_by_type").notNull(),
  paidByUserId: text("paid_by_user_id").references(() => users.id),
  approvalStatus: text("approval_status").notNull().default("DRAFT"),
  settlementStatus: text("settlement_status").notNull().default("NOT_APPLICABLE"),
  assignedApproverId: text("assigned_approver_id").references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  ocrStatus: text("ocr_status").notNull().default("NONE"),
  ocrRawResult: jsonb("ocr_raw_result"),
  ocrConfidence: numeric("ocr_confidence", { precision: 5, scale: 4 }),
  receiptFileId: text("receipt_file_id").references(() => fileObjects.id),
  note: text("note"),
  clientUuid: text("client_uuid").unique(),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenseLines = pgTable("expense_lines", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  expenseId: text("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("PROJECT"),
  projectId: text("project_id").references(() => projects.id),
  costCategoryId: text("cost_category_id").notNull().references(() => costCategories.id),
  budgetLineId: text("budget_line_id").references(() => budgetLines.id),
  poItemId: text("po_item_id").references(() => poItems.id),
  description: text("description").notNull(),
  quantity: quantity("quantity"),
  unitCode: text("unit_code").notNull(),
  unitPrice: money("unit_price"),
  discountAmount: money("discount_amount"),
  lineTotal: money("line_total"),
  ocrDescription: text("ocr_description"),
  ocrValues: jsonb("ocr_values"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const expenseSettlements = pgTable("expense_settlements", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  expenseId: text("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  payeeUserId: text("payee_user_id").notNull().references(() => users.id),
  amount: money("amount"),
  paidDate: date("paid_date").notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  proofFileId: text("proof_file_id").references(() => fileObjects.id),
  createdById: text("created_by_id").notNull().references(() => users.id),
});

export const customerInvoices = pgTable("customer_invoices", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contractTermId: text("contract_term_id").references(() => contractTerms.id),
  number: text("number").notNull().unique(),
  type: text("type").notNull(),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  dppAmount: money("dpp_amount"),
  ppnAmount: money("ppn_amount"),
  totalAmount: money("total_amount"),
  status: text("status").notNull().default("DRAFT"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  overInvoiceReason: text("over_invoice_reason"),
  // 0005: jejak pembuat dipakai pemisahan tugas (pembuat ≠ penyetuju).
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const customerPayments = pgTable("customer_payments", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  invoiceId: text("invoice_id").notNull().references(() => customerInvoices.id, { onDelete: "cascade" }),
  paidDate: date("paid_date").notNull(),
  cashReceivedAmount: money("cash_received_amount"),
  withholdingTaxAmount: money("withholding_tax_amount"),
  withholdingTaxType: text("withholding_tax_type"),
  method: text("method").notNull(),
  reference: text("reference"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const scheduleItems = pgTable("schedule_items", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  type: text("type").notNull(),
  name: text("name").notNull(),
  ownerId: text("owner_id").references(() => users.id),
  plannedStart: date("planned_start"),
  plannedEnd: date("planned_end"),
  actualStart: date("actual_start"),
  actualEnd: date("actual_end"),
  weight: numeric("weight", { precision: 5, scale: 2 }).notNull().default("0"),
  progressPct: numeric("progress_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("NOT_STARTED"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const progressUpdates = pgTable("progress_updates", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  scheduleItemId: text("schedule_item_id").notNull().references(() => scheduleItems.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reportDate: date("report_date").notNull(),
  progressPct: numeric("progress_pct", { precision: 5, scale: 2 }),
  quantity: numeric("quantity", { precision: 18, scale: 4 }),
  unitCode: text("unit_code"),
  note: text("note"),
  issue: text("issue"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  clientUuid: text("client_uuid").unique(),
  createdAt: createdAt(),
});

export const changeOrders = pgTable("change_orders", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  scopeDescription: text("scope_description").notNull(),
  priceImpact: money("price_impact"),
  costImpact: money("cost_impact"),
  timeImpactDays: integer("time_impact_days").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  variationType: text("variation_type").notNull().default("ADD"),
  clientReference: text("client_reference"),
  clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),
  clientApprovedBy: text("client_approved_by").references(() => users.id),
  evidenceFileId: text("evidence_file_id").references(() => fileObjects.id),
  cancelReason: text("cancel_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  supersededByVariationId: text("superseded_by_variation_id"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const punchItems = pgTable("punch_items", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  isClosed: boolean("is_closed").notNull().default(false),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const handoverItems = pgTable("handover_items", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  documentId: text("document_id"),
  isDone: boolean("is_done").notNull().default(false),
});

export const documents = pgTable("documents", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  relatedType: text("related_type"),
  relatedId: text("related_id"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  versionNo: integer("version_no").notNull().default(1),
  revisionNo: integer("revision_no").notNull().default(0),
  templateCode: text("template_code").notNull(),
  templateVersion: integer("template_version").notNull().default(1),
  mergeSnapshot: jsonb("merge_snapshot"),
  blocks: jsonb("blocks"),
  docNumber: text("doc_number").unique(),
  status: text("status").notNull().default("DRAFT"),
  fileId: text("file_id").references(() => fileObjects.id),
  uploadedById: text("uploaded_by_id").notNull().references(() => users.id),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const activityLogs = pgTable("activity_logs", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  requestId: text("request_id"),
  ipAddress: text("ip_address"),
  actorId: text("actor_id").references(() => users.id),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  changes: jsonb("changes"),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});


/* ---------------------------------------------------------------------------
 * S1 · Control-plane tenant. Tabel-tabel ini SENGAJA tidak di-RLS:
 * identitas global (users) + keanggotaan (memberships) dipakai untuk menentukan
 * scope SEBELUM RLS bisa diterapkan. Aksesnya dijaga requireUser() + filter
 * company_id eksplisit pada src/modules/companies/service.ts.
 * ------------------------------------------------------------------------- */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  npwp: text("npwp"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyRole: text("company_role").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    invitedBy: text("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("membership_company_user_unique").on(table.companyId, table.userId),
    index("memberships_user_idx").on(table.userId, table.status),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    companyRole: text("company_role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("invitations_company_email_idx").on(table.companyId, table.email)],
);

export const authEvents = pgTable(
  "auth_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    userId: text("user_id").references(() => users.id),
    email: text("email").notNull(),
    action: text("action").notNull(),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (table) => [index("auth_events_email_time_idx").on(table.email, table.createdAt)],
);

export const projectRelations = relations(projects, ({ many }) => ({
  members: many(projectMembers),
  expenses: many(expenses),
  invoices: many(customerInvoices),
}));


/* -------------------------------------------------------------------------- */
/* S2a · PTK / Variation Order & phasing RAB                                  */
/* -------------------------------------------------------------------------- */

export const variationOrders = pgTable("variation_orders", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  variationType: text("variation_type").notNull(),          // ADD | OMIT | SUBSTITUTE
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  scopeDescription: text("scope_description").notNull(),
  priceImpact: money("price_impact"),                      // BERTANDA
  costImpact: money("cost_impact"),                        // BERTANDA
  timeImpactDays: integer("time_impact_days").notNull().default(0), // BERTANDA
  status: text("status").notNull().default("DRAFT"),
  clientReference: text("client_reference"),
  clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),
  clientApprovedBy: text("client_approved_by").references(() => users.id),
  evidenceFileId: text("evidence_file_id").references(() => fileObjects.id),
  contractValueBefore: money("contract_value_before"),
  contractValueAfter: money("contract_value_after"),
  cancelReason: text("cancel_reason"),
  implementedAt: timestamp("implemented_at", { withTimezone: true }),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("variation_orders_project_idx").on(table.companyId, table.projectId, table.status)]);

export const variationOrderLines = pgTable("variation_order_lines", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  variationOrderId: text("variation_order_id").notNull().references(() => variationOrders.id, { onDelete: "cascade" }),
  action: text("action").notNull(),                        // ADD | OMIT | ADJUST
  budgetType: text("budget_type").notNull().default("INTERNAL"),
  budgetLineId: text("budget_line_id"),
  description: text("description").notNull(),
  quantity: quantity("quantity"),
  unitCode: text("unit_code").notNull().default("Ls"),
  unitAmount: money("unit_amount"),
  priceAmount: money("price_amount"),
  costAmount: money("cost_amount"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("variation_lines_order_idx").on(table.variationOrderId, table.sortOrder)]);

/** Hook B7: distribusi nilai pos RAB per periode untuk kurva-S (S5). */
export const budgetPhasing = pgTable("budget_phasing", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  budgetLineId: text("budget_line_id").notNull().references(() => budgetLines.id, { onDelete: "cascade" }),
  wbsItemId: text("wbs_item_id"),
  periodStart: date("period_start").notNull(),
  plannedValue: money("planned_value"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("budget_phasing_unique").on(table.budgetLineId, table.periodStart)]);


/* -------------------------------------------------------------------------- */
/* S2b · PO line items                                                        */
/* -------------------------------------------------------------------------- */

export const poItems = pgTable("po_items", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  purchaseRecordId: text("purchase_record_id").notNull().references(() => purchaseRecords.id, { onDelete: "cascade" }),
  budgetLineId: text("budget_line_id").references(() => budgetLines.id),
  description: text("description").notNull(),
  quantity: quantity("quantity"),
  unitCode: text("unit_code").notNull().default("Ls"),
  unitAmount: money("unit_amount"),
  dppAmount: money("dpp_amount"),
  receivedQty: quantity("received_qty"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [index("po_items_po_idx").on(table.purchaseRecordId, table.sortOrder)]);


/* -------------------------------------------------------------------------- */
/* S3 · Field photos                                                          */
/* -------------------------------------------------------------------------- */

export const fieldPhotos = pgTable("field_photos", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull().references(() => fileObjects.id, { onDelete: "restrict" }),
  category: text("category").notNull(),
  capturedAt: date("captured_at").notNull(),
  description: text("description"),
  locationLabel: text("location_label"),
  isSelectedForReport: boolean("is_selected_for_report").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  uploadedById: text("uploaded_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  index("field_photos_project_date_idx").on(table.companyId, table.projectId, table.capturedAt, table.category),
  index("field_photos_selected_idx").on(table.companyId, table.projectId, table.isSelectedForReport),
  uniqueIndex("field_photos_file_unique").on(table.companyId, table.fileId),
]);

export const documentPhotoLinks = pgTable("document_photo_links", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`app_current_company_id()`),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  fieldPhotoId: text("field_photo_id").notNull().references(() => fieldPhotos.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  selectedById: text("selected_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("document_photo_links_unique").on(table.documentId, table.fieldPhotoId),
  index("document_photo_links_document_idx").on(table.companyId, table.documentId, table.sortOrder),
]);
