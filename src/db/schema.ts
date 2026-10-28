import { relations } from "drizzle-orm";
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
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const companySettings = pgTable("company_settings", {
  id: id(),
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
  code: text("code").notNull().unique(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  industry: text("industry").notNull(),
  npwp: text("npwp"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sites = pgTable("sites", {
  id: id(),
  clientId: text("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  address: text("address"),
  contact: text("contact"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
});

export const opportunities = pgTable("opportunities", {
  id: id(),
  code: text("code").notNull().unique(),
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
});

export const projects = pgTable("projects", {
  id: id(),
  code: text("code").notNull().unique(),
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
});

export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
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
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isOverhead: boolean("is_overhead").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const units = pgTable("units", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const budgetVersions = pgTable(
  "budget_versions",
  {
    id: id(),
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
  },
  (table) => [uniqueIndex("budget_version_unique").on(table.projectId, table.type, table.versionNo)],
);

export const budgetLines = pgTable("budget_lines", {
  id: id(),
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
});

export const contractTerms = pgTable("contract_terms", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  percent: numeric("percent", { precision: 5, scale: 2 }),
  amount: money("amount"),
  trigger: text("trigger"),
  targetDate: date("target_date"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const purchaseRecords = pgTable("purchase_records", {
  id: id(),
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
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const fileObjects = pgTable("file_objects", {
  id: id(),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  contentBase64: text("content_base64").notNull(),
  uploadedById: text("uploaded_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const expenses = pgTable("expenses", {
  id: id(),
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
  expenseId: text("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("PROJECT"),
  projectId: text("project_id").references(() => projects.id),
  costCategoryId: text("cost_category_id").notNull().references(() => costCategories.id),
  budgetLineId: text("budget_line_id").references(() => budgetLines.id),
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
  createdAt: createdAt(),
});

export const customerPayments = pgTable("customer_payments", {
  id: id(),
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
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  scopeDescription: text("scope_description").notNull(),
  priceImpact: money("price_impact"),
  costImpact: money("cost_impact"),
  timeImpactDays: integer("time_impact_days").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const punchItems = pgTable("punch_items", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  isClosed: boolean("is_closed").notNull().default(false),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const handoverItems = pgTable("handover_items", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  documentId: text("document_id"),
  isDone: boolean("is_done").notNull().default(false),
});

export const documents = pgTable("documents", {
  id: id(),
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
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const projectRelations = relations(projects, ({ many }) => ({
  members: many(projectMembers),
  expenses: many(expenses),
  invoices: many(customerInvoices),
}));
