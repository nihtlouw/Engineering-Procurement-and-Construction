-- ==========================================================================
-- BASELINE SKEMA PENUH (idempoten) — DIHASILKAN, JANGAN DIEDIT TANGAN.
--
-- Sumber: src/db/schema.ts melalui `npm run db:baseline` (drizzle-kit generate).
-- Kenapa ada: rantai 0000-0011 BERSIFAT INKREMENTAL. 0000_tenant_foundation
-- hanya menambah company_id/RLS pada tabel yang SUDAH ADA; ia tidak membuat
-- users, sessions, atau 24 tabel bisnis. Menjalankan rantai itu pada database
-- kosong selalu gagal (relation "users" does not exist) — terverifikasi.
--
-- Berkas ini membuat SELURUH skema sehingga database kosong menjadi utuh, dan
-- pada database yang SUDAH berisi data ia hanya menambah yang belum ada:
--   * tabel  -> CREATE TABLE IF NOT EXISTS (tabel lama dilewati, data utuh)
--   * kolom  -> blok PENAMBAL KOLOM (hanya kolom yang hilang)
--   * FK     -> blok terpisah, dilewati bila kolomnya belum ada (dicatat)
-- Semua penyesuaian dicatat di tabel `_baseline_warnings`; periksa setelah
-- menjalankan berkas ini.
--
-- Yang TIDAK dilakukan: seed data, dan RLS/policy (itu tugas 0001).
-- ==========================================================================

begin;

-- Fungsi pembantu GUC dipakai DEFAULT kolom di bawah, jadi harus dibuat lebih
-- dulu. Definisi identik dengan 0000_tenant_foundation.sql (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_company_id', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS "activity_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"request_id" text,
	"ip_address" text,
	"actor_id" text,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"project_id" text,
	"action" text NOT NULL,
	"changes" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" text,
	"email" text NOT NULL,
	"action" text NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "budget_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"budget_version_id" text NOT NULL,
	"cost_category_id" text NOT NULL,
	"code" text,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_code" text NOT NULL,
	"unit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"contingency_pct" numeric(5, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"line_status" text DEFAULT 'ACTIVE' NOT NULL,
	"variation_action" text,
	"source_variation_id" text,
	"wbs_item_id" text,
	"keywords" text
);

CREATE TABLE IF NOT EXISTS "budget_phasing" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"budget_line_id" text NOT NULL,
	"wbs_item_id" text,
	"period_start" date NOT NULL,
	"planned_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "budget_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"is_active_baseline" boolean DEFAULT false NOT NULL,
	"change_order_id" text,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"approved_by_id" text,
	"approved_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision_note" text,
	"locked_at" timestamp with time zone,
	"superseded_by" text,
	"source_variation_id" text,
	"created_from_version_id" text
);

CREATE TABLE IF NOT EXISTS "change_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"scope_description" text NOT NULL,
	"price_impact" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cost_impact" numeric(18, 2) DEFAULT '0' NOT NULL,
	"time_impact_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"variation_type" text DEFAULT 'ADD' NOT NULL,
	"client_reference" text,
	"client_approved_at" timestamp with time zone,
	"client_approved_by" text,
	"evidence_file_id" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"superseded_by_variation_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_orders_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"industry" text NOT NULL,
	"npwp" text,
	"address" text,
	"contact_name" text,
	"contact_phone" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"npwp" text,
	"address" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "company_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"npwp" text,
	"address" text,
	"phone" text,
	"email" text,
	"base_currency" text DEFAULT 'IDR' NOT NULL,
	"default_ppn_rate" numeric(5, 2) DEFAULT '11' NOT NULL,
	"allow_split_expense" boolean DEFAULT false NOT NULL,
	"require_separation_of_duty" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "contract_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"percent" numeric(5, 2),
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"trigger" text,
	"target_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"invoiced_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"is_auto_amount" boolean DEFAULT true NOT NULL,
	"notes" text
);

CREATE TABLE IF NOT EXISTS "cost_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_overhead" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "customer_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"contract_term_id" text,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"dpp_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ppn_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"sent_at" timestamp with time zone,
	"cancel_reason" text,
	"over_invoice_reason" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invoices_number_unique" UNIQUE("number")
);

CREATE TABLE IF NOT EXISTS "customer_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"invoice_id" text NOT NULL,
	"paid_date" date NOT NULL,
	"cash_received_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"withholding_tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"withholding_tax_type" text,
	"method" text NOT NULL,
	"reference" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_photo_links" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"document_id" text NOT NULL,
	"field_photo_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"selected_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_template_variables" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"template_id" text NOT NULL,
	"tag" text NOT NULL,
	"label" text NOT NULL,
	"var_type" text DEFAULT 'TEXT' NOT NULL,
	"source" text NOT NULL,
	"sample_value" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"blocks" jsonb,
	"docx_file_id" text,
	"variables" jsonb,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"base_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'BLOCKS' NOT NULL,
	"blocks" jsonb,
	"docx_file_id" text,
	"signature_parties" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text,
	"related_type" text,
	"related_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"template_code" text,
	"template_id" text,
	"template_name" text,
	"template_version" integer DEFAULT 1 NOT NULL,
	"template_snapshot" jsonb,
	"merge_snapshot" jsonb,
	"blocks" jsonb,
	"doc_number" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"file_id" text,
	"docx_file_id" text,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"archive_reason" text,
	"uploaded_by_id" text NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_doc_number_unique" UNIQUE("doc_number")
);

CREATE TABLE IF NOT EXISTS "expense_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"expense_id" text NOT NULL,
	"scope" text DEFAULT 'PROJECT' NOT NULL,
	"project_id" text,
	"cost_category_id" text NOT NULL,
	"budget_line_id" text,
	"po_item_id" text,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_code" text NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ocr_description" text,
	"ocr_values" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "expense_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"expense_id" text NOT NULL,
	"payee_user_id" text NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_date" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"proof_file_id" text,
	"created_by_id" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"code" text NOT NULL,
	"type" text DEFAULT 'FIELD_EXPENSE' NOT NULL,
	"default_scope" text DEFAULT 'PROJECT' NOT NULL,
	"default_project_id" text,
	"is_split" boolean DEFAULT false NOT NULL,
	"is_pre_baseline" boolean DEFAULT false NOT NULL,
	"purchase_record_id" text,
	"merchant_name" text,
	"receipt_number" text,
	"transaction_date" date NOT NULL,
	"original_currency" text DEFAULT 'IDR' NOT NULL,
	"original_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"dpp_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ppn_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"mismatch_reason" text,
	"duplicate_reason" text,
	"payment_method" text NOT NULL,
	"paid_by_type" text NOT NULL,
	"paid_by_user_id" text,
	"approval_status" text DEFAULT 'DRAFT' NOT NULL,
	"settlement_status" text DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"assigned_approver_id" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"void_reason" text,
	"ocr_status" text DEFAULT 'NONE' NOT NULL,
	"ocr_raw_result" jsonb,
	"ocr_confidence" numeric(5, 4),
	"receipt_file_id" text,
	"note" text,
	"client_uuid" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_code_unique" UNIQUE("code"),
	CONSTRAINT "expenses_client_uuid_unique" UNIQUE("client_uuid")
);

CREATE TABLE IF NOT EXISTS "field_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"file_id" text NOT NULL,
	"category" text NOT NULL,
	"captured_at" date NOT NULL,
	"description" text,
	"location_label" text,
	"is_selected_for_report" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "file_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_base64" text,
	"storage_provider" text DEFAULT 'DB' NOT NULL,
	"storage_bucket" text,
	"width" integer,
	"height" integer,
	"original_size_bytes" integer,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_objects_storage_key_unique" UNIQUE("storage_key")
);

CREATE TABLE IF NOT EXISTS "handover_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"document_id" text,
	"is_done" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"company_role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"company_role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"invited_by" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"client_id" text NOT NULL,
	"site_id" text,
	"requirement" text,
	"owner_id" text NOT NULL,
	"due_date" date,
	"estimated_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"outcome_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "po_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"purchase_record_id" text NOT NULL,
	"budget_line_id" text,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'Ls' NOT NULL,
	"unit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"dpp_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "progress_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"schedule_item_id" text NOT NULL,
	"project_id" text NOT NULL,
	"report_date" date NOT NULL,
	"progress_pct" numeric(5, 2),
	"quantity" numeric(18, 4),
	"unit_code" text,
	"note" text,
	"issue" text,
	"created_by_id" text NOT NULL,
	"client_uuid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_updates_client_uuid_unique" UNIQUE("client_uuid")
);

CREATE TABLE IF NOT EXISTS "project_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_role" text NOT NULL,
	"start_date" date,
	"end_date" date
);

CREATE TABLE IF NOT EXISTS "project_wbs_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"start_date" date,
	"total_weight" numeric(7, 2) DEFAULT '0' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"weighted_progress" numeric(7, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"locked_at" timestamp with time zone,
	"locked_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"client_id" text NOT NULL,
	"site_id" text,
	"opportunity_id" text,
	"pm_id" text,
	"stage" text DEFAULT 'AWAITING_KICKOFF' NOT NULL,
	"hold" text DEFAULT 'NONE' NOT NULL,
	"contract_number" text,
	"contract_date" date,
	"contract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"contract_value_current" numeric(18, 2) DEFAULT '0' NOT NULL,
	"contract_ppn" numeric(18, 2) DEFAULT '0' NOT NULL,
	"retention_pct" numeric(5, 2) DEFAULT '5' NOT NULL,
	"warranty_months" integer DEFAULT 12 NOT NULL,
	"start_date" date,
	"target_end_date" date,
	"bast1_date" date,
	"bast2_date" date,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_opportunity_id_unique" UNIQUE("opportunity_id")
);

CREATE TABLE IF NOT EXISTS "punch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"description" text NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "purchase_records" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"supplier_name" text NOT NULL,
	"po_number" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"summary" text NOT NULL,
	"dpp_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ppn_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"order_date" date,
	"expected_date" date,
	"budget_line_id" text,
	"received_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" text,
	"planned_start" date,
	"planned_end" date,
	"actual_start" date,
	"actual_end" date,
	"weight" numeric(5, 2) DEFAULT '0' NOT NULL,
	"progress_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"code" text,
	"is_summary" boolean DEFAULT false NOT NULL,
	"committed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"planned_pct_per_period" numeric(9, 4),
	"parent_sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"contact" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7)
);

CREATE TABLE IF NOT EXISTS "units" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "variation_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"variation_order_id" text NOT NULL,
	"action" text NOT NULL,
	"budget_type" text DEFAULT 'INTERNAL' NOT NULL,
	"budget_line_id" text,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'Ls' NOT NULL,
	"unit_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"price_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cost_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "variation_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT app_current_company_id() NOT NULL,
	"project_id" text NOT NULL,
	"code" text NOT NULL,
	"variation_type" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"scope_description" text NOT NULL,
	"price_impact" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cost_impact" numeric(18, 2) DEFAULT '0' NOT NULL,
	"time_impact_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"client_reference" text,
	"client_approved_at" timestamp with time zone,
	"client_approved_by" text,
	"evidence_file_id" text,
	"contract_value_before" numeric(18, 2) DEFAULT '0' NOT NULL,
	"contract_value_after" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cancel_reason" text,
	"implemented_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variation_orders_code_unique" UNIQUE("code")
);

CREATE INDEX IF NOT EXISTS "auth_events_email_time_idx" ON "auth_events" USING btree ("email","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_phasing_unique" ON "budget_phasing" USING btree ("budget_line_id","period_start");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_version_unique" ON "budget_versions" USING btree ("project_id","type","version_no");
CREATE UNIQUE INDEX IF NOT EXISTS "clients_company_code_idx" ON "clients" USING btree ("company_id","code");
CREATE UNIQUE INDEX IF NOT EXISTS "contract_terms_project_sort_idx" ON "contract_terms" USING btree ("company_id","project_id","sort_order");
CREATE INDEX IF NOT EXISTS "contract_terms_project_idx" ON "contract_terms" USING btree ("company_id","project_id","type");
CREATE UNIQUE INDEX IF NOT EXISTS "cost_categories_company_code_idx" ON "cost_categories" USING btree ("company_id","code");
CREATE UNIQUE INDEX IF NOT EXISTS "document_photo_links_unique" ON "document_photo_links" USING btree ("document_id","field_photo_id");
CREATE INDEX IF NOT EXISTS "document_photo_links_document_idx" ON "document_photo_links" USING btree ("company_id","document_id","sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_company_code_idx" ON "document_templates" USING btree ("company_id","code") WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_system_code_idx" ON "document_templates" USING btree ("code") WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS "document_templates_company_active_idx" ON "document_templates" USING btree ("company_id","is_active","code");
CREATE INDEX IF NOT EXISTS "documents_template_idx" ON "documents" USING btree ("company_id","template_id");
CREATE INDEX IF NOT EXISTS "documents_project_status_idx" ON "documents" USING btree ("company_id","project_id","status");
CREATE INDEX IF NOT EXISTS "field_photos_project_date_idx" ON "field_photos" USING btree ("company_id","project_id","captured_at","category");
CREATE INDEX IF NOT EXISTS "field_photos_selected_idx" ON "field_photos" USING btree ("company_id","project_id","is_selected_for_report");
CREATE UNIQUE INDEX IF NOT EXISTS "field_photos_file_unique" ON "field_photos" USING btree ("company_id","file_id");
CREATE INDEX IF NOT EXISTS "invitations_company_email_idx" ON "invitations" USING btree ("company_id","email");
CREATE UNIQUE INDEX IF NOT EXISTS "membership_company_user_unique" ON "memberships" USING btree ("company_id","user_id");
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "opportunities_company_code_idx" ON "opportunities" USING btree ("company_id","code");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_idx" ON "password_reset_tokens" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "po_items_po_idx" ON "po_items" USING btree ("purchase_record_id","sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "project_member_unique" ON "project_members" USING btree ("project_id","user_id","project_role");
CREATE UNIQUE INDEX IF NOT EXISTS "project_wbs_calendars_version_idx" ON "project_wbs_calendars" USING btree ("company_id","project_id","version");
CREATE UNIQUE INDEX IF NOT EXISTS "projects_company_code_idx" ON "projects" USING btree ("company_id","code");
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_items_project_code_idx" ON "schedule_items" USING btree ("company_id","project_id","code") WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS "schedule_items_project_level_idx" ON "schedule_items" USING btree ("company_id","project_id","level","sort_order");
CREATE INDEX IF NOT EXISTS "schedule_items_parent_idx" ON "schedule_items" USING btree ("company_id","parent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "units_company_code_idx" ON "units" USING btree ("company_id","code");
CREATE INDEX IF NOT EXISTS "variation_lines_order_idx" ON "variation_order_lines" USING btree ("variation_order_id","sort_order");
CREATE INDEX IF NOT EXISTS "variation_orders_project_idx" ON "variation_orders" USING btree ("company_id","project_id","status");

-- Catatan penyesuaian baseline (FK dilewati, kolom ditambal).
create table if not exists _baseline_warnings (
  kind      text not null,
  object    text not null,
  detail    text not null,
  noted_at  timestamptz not null default now(),
  primary key (kind, object)
);

-- --------------------------------------------------------------------------
-- PENAMBAL KOLOM: tabel yang SUDAH ada tidak dibuat ulang oleh CREATE TABLE
-- IF NOT EXISTS, sehingga kolom yang belum pernah ada (mis. `projects.stage`)
-- tetap hilang dan migrasi berikutnya gagal "column ... does not exist".
-- Blok ini menambahkan kolom yang hilang TANPA menyentuh baris lama; setiap
-- penambalan dicatat di `_baseline_warnings`.
-- --------------------------------------------------------------------------
DO $repair$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('activity_logs', 'id', 'text'),
      ('activity_logs', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('activity_logs', 'request_id', 'text'),
      ('activity_logs', 'ip_address', 'text'),
      ('activity_logs', 'actor_id', 'text'),
      ('activity_logs', 'object_type', 'text'),
      ('activity_logs', 'object_id', 'text'),
      ('activity_logs', 'project_id', 'text'),
      ('activity_logs', 'action', 'text'),
      ('activity_logs', 'changes', 'jsonb'),
      ('activity_logs', 'reason', 'text'),
      ('activity_logs', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('auth_events', 'id', 'uuid DEFAULT gen_random_uuid()'),
      ('auth_events', 'company_id', 'uuid'),
      ('auth_events', 'user_id', 'text'),
      ('auth_events', 'email', 'text'),
      ('auth_events', 'action', 'text'),
      ('auth_events', 'ip_address', 'text'),
      ('auth_events', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('budget_lines', 'id', 'text'),
      ('budget_lines', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('budget_lines', 'budget_version_id', 'text'),
      ('budget_lines', 'cost_category_id', 'text'),
      ('budget_lines', 'code', 'text'),
      ('budget_lines', 'description', 'text'),
      ('budget_lines', 'quantity', 'numeric(18, 4) DEFAULT ''0'''),
      ('budget_lines', 'unit_code', 'text'),
      ('budget_lines', 'unit_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('budget_lines', 'total', 'numeric(18, 2) DEFAULT ''0'''),
      ('budget_lines', 'contingency_pct', 'numeric(5, 2)'),
      ('budget_lines', 'sort_order', 'integer DEFAULT 0'),
      ('budget_lines', 'line_status', 'text DEFAULT ''ACTIVE'''),
      ('budget_lines', 'variation_action', 'text'),
      ('budget_lines', 'source_variation_id', 'text'),
      ('budget_lines', 'wbs_item_id', 'text'),
      ('budget_lines', 'keywords', 'text'),
      ('budget_phasing', 'id', 'text'),
      ('budget_phasing', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('budget_phasing', 'budget_line_id', 'text'),
      ('budget_phasing', 'wbs_item_id', 'text'),
      ('budget_phasing', 'period_start', 'date'),
      ('budget_phasing', 'planned_value', 'numeric(18, 2) DEFAULT ''0'''),
      ('budget_phasing', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('budget_versions', 'id', 'text'),
      ('budget_versions', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('budget_versions', 'project_id', 'text'),
      ('budget_versions', 'type', 'text'),
      ('budget_versions', 'version_no', 'integer'),
      ('budget_versions', 'status', 'text DEFAULT ''DRAFT'''),
      ('budget_versions', 'is_active_baseline', 'boolean DEFAULT false'),
      ('budget_versions', 'change_order_id', 'text'),
      ('budget_versions', 'total', 'numeric(18, 2) DEFAULT ''0'''),
      ('budget_versions', 'approved_by_id', 'text'),
      ('budget_versions', 'approved_at', 'timestamp with time zone'),
      ('budget_versions', 'created_by_id', 'text'),
      ('budget_versions', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('budget_versions', 'revision_note', 'text'),
      ('budget_versions', 'locked_at', 'timestamp with time zone'),
      ('budget_versions', 'superseded_by', 'text'),
      ('budget_versions', 'source_variation_id', 'text'),
      ('budget_versions', 'created_from_version_id', 'text'),
      ('change_orders', 'id', 'text'),
      ('change_orders', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('change_orders', 'project_id', 'text'),
      ('change_orders', 'code', 'text'),
      ('change_orders', 'title', 'text'),
      ('change_orders', 'reason', 'text'),
      ('change_orders', 'scope_description', 'text'),
      ('change_orders', 'price_impact', 'numeric(18, 2) DEFAULT ''0'''),
      ('change_orders', 'cost_impact', 'numeric(18, 2) DEFAULT ''0'''),
      ('change_orders', 'time_impact_days', 'integer DEFAULT 0'),
      ('change_orders', 'status', 'text DEFAULT ''DRAFT'''),
      ('change_orders', 'variation_type', 'text DEFAULT ''ADD'''),
      ('change_orders', 'client_reference', 'text'),
      ('change_orders', 'client_approved_at', 'timestamp with time zone'),
      ('change_orders', 'client_approved_by', 'text'),
      ('change_orders', 'evidence_file_id', 'text'),
      ('change_orders', 'cancel_reason', 'text'),
      ('change_orders', 'cancelled_at', 'timestamp with time zone'),
      ('change_orders', 'superseded_by_variation_id', 'text'),
      ('change_orders', 'created_by_id', 'text'),
      ('change_orders', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('clients', 'id', 'text'),
      ('clients', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('clients', 'code', 'text'),
      ('clients', 'legal_name', 'text'),
      ('clients', 'display_name', 'text'),
      ('clients', 'industry', 'text'),
      ('clients', 'npwp', 'text'),
      ('clients', 'address', 'text'),
      ('clients', 'contact_name', 'text'),
      ('clients', 'contact_phone', 'text'),
      ('clients', 'deleted_at', 'timestamp with time zone'),
      ('clients', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('companies', 'id', 'uuid DEFAULT gen_random_uuid()'),
      ('companies', 'slug', 'text'),
      ('companies', 'name', 'text'),
      ('companies', 'legal_name', 'text'),
      ('companies', 'npwp', 'text'),
      ('companies', 'address', 'text'),
      ('companies', 'phone', 'text'),
      ('companies', 'email', 'text'),
      ('companies', 'is_active', 'boolean DEFAULT true'),
      ('companies', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('companies', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('company_settings', 'id', 'text'),
      ('company_settings', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('company_settings', 'legal_name', 'text'),
      ('company_settings', 'display_name', 'text'),
      ('company_settings', 'npwp', 'text'),
      ('company_settings', 'address', 'text'),
      ('company_settings', 'phone', 'text'),
      ('company_settings', 'email', 'text'),
      ('company_settings', 'base_currency', 'text DEFAULT ''IDR'''),
      ('company_settings', 'default_ppn_rate', 'numeric(5, 2) DEFAULT ''11'''),
      ('company_settings', 'allow_split_expense', 'boolean DEFAULT false'),
      ('company_settings', 'require_separation_of_duty', 'boolean DEFAULT true'),
      ('company_settings', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('contract_terms', 'id', 'text'),
      ('contract_terms', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('contract_terms', 'project_id', 'text'),
      ('contract_terms', 'type', 'text'),
      ('contract_terms', 'name', 'text'),
      ('contract_terms', 'percent', 'numeric(5, 2)'),
      ('contract_terms', 'amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('contract_terms', 'trigger', 'text'),
      ('contract_terms', 'target_date', 'date'),
      ('contract_terms', 'sort_order', 'integer DEFAULT 0'),
      ('contract_terms', 'invoiced_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('contract_terms', 'status', 'text DEFAULT ''OPEN'''),
      ('contract_terms', 'is_auto_amount', 'boolean DEFAULT true'),
      ('contract_terms', 'notes', 'text'),
      ('cost_categories', 'id', 'text'),
      ('cost_categories', 'company_id', 'uuid'),
      ('cost_categories', 'code', 'text'),
      ('cost_categories', 'name', 'text'),
      ('cost_categories', 'is_overhead', 'boolean DEFAULT false'),
      ('cost_categories', 'is_active', 'boolean DEFAULT true'),
      ('cost_categories', 'created_by_id', 'text'),
      ('cost_categories', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('customer_invoices', 'id', 'text'),
      ('customer_invoices', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('customer_invoices', 'project_id', 'text'),
      ('customer_invoices', 'contract_term_id', 'text'),
      ('customer_invoices', 'number', 'text'),
      ('customer_invoices', 'type', 'text'),
      ('customer_invoices', 'issue_date', 'date'),
      ('customer_invoices', 'due_date', 'date'),
      ('customer_invoices', 'dpp_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('customer_invoices', 'ppn_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('customer_invoices', 'total_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('customer_invoices', 'status', 'text DEFAULT ''DRAFT'''),
      ('customer_invoices', 'sent_at', 'timestamp with time zone'),
      ('customer_invoices', 'cancel_reason', 'text'),
      ('customer_invoices', 'over_invoice_reason', 'text'),
      ('customer_invoices', 'created_by_id', 'text'),
      ('customer_invoices', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('customer_payments', 'id', 'text'),
      ('customer_payments', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('customer_payments', 'invoice_id', 'text'),
      ('customer_payments', 'paid_date', 'date'),
      ('customer_payments', 'cash_received_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('customer_payments', 'withholding_tax_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('customer_payments', 'withholding_tax_type', 'text'),
      ('customer_payments', 'method', 'text'),
      ('customer_payments', 'reference', 'text'),
      ('customer_payments', 'created_by_id', 'text'),
      ('customer_payments', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('document_photo_links', 'id', 'text'),
      ('document_photo_links', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('document_photo_links', 'document_id', 'text'),
      ('document_photo_links', 'field_photo_id', 'text'),
      ('document_photo_links', 'sort_order', 'integer DEFAULT 0'),
      ('document_photo_links', 'selected_by_id', 'text'),
      ('document_photo_links', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('document_template_variables', 'id', 'text'),
      ('document_template_variables', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('document_template_variables', 'template_id', 'text'),
      ('document_template_variables', 'tag', 'text'),
      ('document_template_variables', 'label', 'text'),
      ('document_template_variables', 'var_type', 'text DEFAULT ''TEXT'''),
      ('document_template_variables', 'source', 'text'),
      ('document_template_variables', 'sample_value', 'text'),
      ('document_template_variables', 'is_required', 'boolean DEFAULT true'),
      ('document_template_variables', 'sort_order', 'integer DEFAULT 0'),
      ('document_template_variables', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('document_template_versions', 'id', 'text'),
      ('document_template_versions', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('document_template_versions', 'template_id', 'text'),
      ('document_template_versions', 'version', 'integer'),
      ('document_template_versions', 'name', 'text'),
      ('document_template_versions', 'blocks', 'jsonb'),
      ('document_template_versions', 'docx_file_id', 'text'),
      ('document_template_versions', 'variables', 'jsonb'),
      ('document_template_versions', 'note', 'text'),
      ('document_template_versions', 'created_by_id', 'text'),
      ('document_template_versions', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('document_templates', 'id', 'text'),
      ('document_templates', 'company_id', 'uuid'),
      ('document_templates', 'code', 'text'),
      ('document_templates', 'name', 'text'),
      ('document_templates', 'description', 'text'),
      ('document_templates', 'category', 'text DEFAULT ''OTHER'''),
      ('document_templates', 'base_code', 'text'),
      ('document_templates', 'version', 'integer DEFAULT 1'),
      ('document_templates', 'kind', 'text DEFAULT ''BLOCKS'''),
      ('document_templates', 'blocks', 'jsonb'),
      ('document_templates', 'docx_file_id', 'text'),
      ('document_templates', 'signature_parties', 'jsonb'),
      ('document_templates', 'is_active', 'boolean DEFAULT true'),
      ('document_templates', 'is_system', 'boolean DEFAULT false'),
      ('document_templates', 'created_by_id', 'text'),
      ('document_templates', 'updated_by_id', 'text'),
      ('document_templates', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('document_templates', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('documents', 'id', 'text'),
      ('documents', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('documents', 'project_id', 'text'),
      ('documents', 'related_type', 'text'),
      ('documents', 'related_id', 'text'),
      ('documents', 'category', 'text'),
      ('documents', 'title', 'text'),
      ('documents', 'version_no', 'integer DEFAULT 1'),
      ('documents', 'revision_no', 'integer DEFAULT 0'),
      ('documents', 'template_code', 'text'),
      ('documents', 'template_id', 'text'),
      ('documents', 'template_name', 'text'),
      ('documents', 'template_version', 'integer DEFAULT 1'),
      ('documents', 'template_snapshot', 'jsonb'),
      ('documents', 'merge_snapshot', 'jsonb'),
      ('documents', 'blocks', 'jsonb'),
      ('documents', 'doc_number', 'text'),
      ('documents', 'status', 'text DEFAULT ''DRAFT'''),
      ('documents', 'file_id', 'text'),
      ('documents', 'docx_file_id', 'text'),
      ('documents', 'archived_at', 'timestamp with time zone'),
      ('documents', 'archived_by_id', 'text'),
      ('documents', 'archive_reason', 'text'),
      ('documents', 'uploaded_by_id', 'text'),
      ('documents', 'finalized_at', 'timestamp with time zone'),
      ('documents', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('expense_lines', 'id', 'text'),
      ('expense_lines', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('expense_lines', 'expense_id', 'text'),
      ('expense_lines', 'scope', 'text DEFAULT ''PROJECT'''),
      ('expense_lines', 'project_id', 'text'),
      ('expense_lines', 'cost_category_id', 'text'),
      ('expense_lines', 'budget_line_id', 'text'),
      ('expense_lines', 'po_item_id', 'text'),
      ('expense_lines', 'description', 'text'),
      ('expense_lines', 'quantity', 'numeric(18, 4) DEFAULT ''0'''),
      ('expense_lines', 'unit_code', 'text'),
      ('expense_lines', 'unit_price', 'numeric(18, 2) DEFAULT ''0'''),
      ('expense_lines', 'discount_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expense_lines', 'line_total', 'numeric(18, 2) DEFAULT ''0'''),
      ('expense_lines', 'ocr_description', 'text'),
      ('expense_lines', 'ocr_values', 'jsonb'),
      ('expense_lines', 'sort_order', 'integer DEFAULT 0'),
      ('expense_settlements', 'id', 'text'),
      ('expense_settlements', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('expense_settlements', 'expense_id', 'text'),
      ('expense_settlements', 'payee_user_id', 'text'),
      ('expense_settlements', 'amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expense_settlements', 'paid_date', 'date'),
      ('expense_settlements', 'method', 'text'),
      ('expense_settlements', 'reference', 'text'),
      ('expense_settlements', 'proof_file_id', 'text'),
      ('expense_settlements', 'created_by_id', 'text'),
      ('expenses', 'id', 'text'),
      ('expenses', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('expenses', 'code', 'text'),
      ('expenses', 'type', 'text DEFAULT ''FIELD_EXPENSE'''),
      ('expenses', 'default_scope', 'text DEFAULT ''PROJECT'''),
      ('expenses', 'default_project_id', 'text'),
      ('expenses', 'is_split', 'boolean DEFAULT false'),
      ('expenses', 'is_pre_baseline', 'boolean DEFAULT false'),
      ('expenses', 'purchase_record_id', 'text'),
      ('expenses', 'merchant_name', 'text'),
      ('expenses', 'receipt_number', 'text'),
      ('expenses', 'transaction_date', 'date'),
      ('expenses', 'original_currency', 'text DEFAULT ''IDR'''),
      ('expenses', 'original_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'exchange_rate', 'numeric(18, 6) DEFAULT ''1'''),
      ('expenses', 'subtotal', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'discount_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'dpp_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'ppn_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'total_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('expenses', 'mismatch_reason', 'text'),
      ('expenses', 'duplicate_reason', 'text'),
      ('expenses', 'payment_method', 'text'),
      ('expenses', 'paid_by_type', 'text'),
      ('expenses', 'paid_by_user_id', 'text'),
      ('expenses', 'approval_status', 'text DEFAULT ''DRAFT'''),
      ('expenses', 'settlement_status', 'text DEFAULT ''NOT_APPLICABLE'''),
      ('expenses', 'assigned_approver_id', 'text'),
      ('expenses', 'submitted_at', 'timestamp with time zone'),
      ('expenses', 'approved_at', 'timestamp with time zone'),
      ('expenses', 'void_reason', 'text'),
      ('expenses', 'ocr_status', 'text DEFAULT ''NONE'''),
      ('expenses', 'ocr_raw_result', 'jsonb'),
      ('expenses', 'ocr_confidence', 'numeric(5, 4)'),
      ('expenses', 'receipt_file_id', 'text'),
      ('expenses', 'note', 'text'),
      ('expenses', 'client_uuid', 'text'),
      ('expenses', 'created_by_id', 'text'),
      ('expenses', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('expenses', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('field_photos', 'id', 'text'),
      ('field_photos', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('field_photos', 'project_id', 'text'),
      ('field_photos', 'file_id', 'text'),
      ('field_photos', 'category', 'text'),
      ('field_photos', 'captured_at', 'date'),
      ('field_photos', 'description', 'text'),
      ('field_photos', 'location_label', 'text'),
      ('field_photos', 'is_selected_for_report', 'boolean DEFAULT false'),
      ('field_photos', 'sort_order', 'integer DEFAULT 0'),
      ('field_photos', 'uploaded_by_id', 'text'),
      ('field_photos', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('file_objects', 'id', 'text'),
      ('file_objects', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('file_objects', 'storage_key', 'text'),
      ('file_objects', 'file_name', 'text'),
      ('file_objects', 'mime_type', 'text'),
      ('file_objects', 'size_bytes', 'integer'),
      ('file_objects', 'sha256', 'text'),
      ('file_objects', 'content_base64', 'text'),
      ('file_objects', 'storage_provider', 'text DEFAULT ''DB'''),
      ('file_objects', 'storage_bucket', 'text'),
      ('file_objects', 'width', 'integer'),
      ('file_objects', 'height', 'integer'),
      ('file_objects', 'original_size_bytes', 'integer'),
      ('file_objects', 'uploaded_by_id', 'text'),
      ('file_objects', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('handover_items', 'id', 'text'),
      ('handover_items', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('handover_items', 'project_id', 'text'),
      ('handover_items', 'name', 'text'),
      ('handover_items', 'is_required', 'boolean DEFAULT true'),
      ('handover_items', 'document_id', 'text'),
      ('handover_items', 'is_done', 'boolean DEFAULT false'),
      ('invitations', 'id', 'uuid DEFAULT gen_random_uuid()'),
      ('invitations', 'company_id', 'uuid'),
      ('invitations', 'email', 'text'),
      ('invitations', 'company_role', 'text'),
      ('invitations', 'token_hash', 'text'),
      ('invitations', 'invited_by', 'text'),
      ('invitations', 'expires_at', 'timestamp with time zone'),
      ('invitations', 'accepted_at', 'timestamp with time zone'),
      ('invitations', 'revoked_at', 'timestamp with time zone'),
      ('invitations', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('memberships', 'id', 'uuid DEFAULT gen_random_uuid()'),
      ('memberships', 'company_id', 'uuid'),
      ('memberships', 'user_id', 'text'),
      ('memberships', 'company_role', 'text'),
      ('memberships', 'status', 'text DEFAULT ''ACTIVE'''),
      ('memberships', 'invited_by', 'text'),
      ('memberships', 'joined_at', 'timestamp with time zone DEFAULT now()'),
      ('memberships', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('memberships', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('notifications', 'id', 'text'),
      ('notifications', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('notifications', 'user_id', 'text'),
      ('notifications', 'type', 'text'),
      ('notifications', 'title', 'text'),
      ('notifications', 'body', 'text'),
      ('notifications', 'link', 'text'),
      ('notifications', 'read_at', 'timestamp with time zone'),
      ('notifications', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('opportunities', 'id', 'text'),
      ('opportunities', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('opportunities', 'code', 'text'),
      ('opportunities', 'title', 'text'),
      ('opportunities', 'client_id', 'text'),
      ('opportunities', 'site_id', 'text'),
      ('opportunities', 'requirement', 'text'),
      ('opportunities', 'owner_id', 'text'),
      ('opportunities', 'due_date', 'date'),
      ('opportunities', 'estimated_value', 'numeric(18, 2) DEFAULT ''0'''),
      ('opportunities', 'status', 'text DEFAULT ''DRAFT'''),
      ('opportunities', 'outcome_reason', 'text'),
      ('opportunities', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('password_reset_tokens', 'id', 'uuid DEFAULT gen_random_uuid()'),
      ('password_reset_tokens', 'user_id', 'text'),
      ('password_reset_tokens', 'token_hash', 'text'),
      ('password_reset_tokens', 'requested_ip', 'text'),
      ('password_reset_tokens', 'expires_at', 'timestamp with time zone'),
      ('password_reset_tokens', 'used_at', 'timestamp with time zone'),
      ('password_reset_tokens', 'revoked_at', 'timestamp with time zone'),
      ('password_reset_tokens', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('po_items', 'id', 'text'),
      ('po_items', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('po_items', 'purchase_record_id', 'text'),
      ('po_items', 'budget_line_id', 'text'),
      ('po_items', 'description', 'text'),
      ('po_items', 'quantity', 'numeric(18, 4) DEFAULT ''0'''),
      ('po_items', 'unit_code', 'text DEFAULT ''Ls'''),
      ('po_items', 'unit_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('po_items', 'dpp_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('po_items', 'received_qty', 'numeric(18, 4) DEFAULT ''0'''),
      ('po_items', 'sort_order', 'integer DEFAULT 0'),
      ('progress_updates', 'id', 'text'),
      ('progress_updates', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('progress_updates', 'schedule_item_id', 'text'),
      ('progress_updates', 'project_id', 'text'),
      ('progress_updates', 'report_date', 'date'),
      ('progress_updates', 'progress_pct', 'numeric(5, 2)'),
      ('progress_updates', 'quantity', 'numeric(18, 4)'),
      ('progress_updates', 'unit_code', 'text'),
      ('progress_updates', 'note', 'text'),
      ('progress_updates', 'issue', 'text'),
      ('progress_updates', 'created_by_id', 'text'),
      ('progress_updates', 'client_uuid', 'text'),
      ('progress_updates', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('project_members', 'id', 'text'),
      ('project_members', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('project_members', 'project_id', 'text'),
      ('project_members', 'user_id', 'text'),
      ('project_members', 'project_role', 'text'),
      ('project_members', 'start_date', 'date'),
      ('project_members', 'end_date', 'date'),
      ('project_wbs_calendars', 'id', 'text'),
      ('project_wbs_calendars', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('project_wbs_calendars', 'project_id', 'text'),
      ('project_wbs_calendars', 'version', 'integer DEFAULT 1'),
      ('project_wbs_calendars', 'status', 'text DEFAULT ''DRAFT'''),
      ('project_wbs_calendars', 'start_date', 'date'),
      ('project_wbs_calendars', 'total_weight', 'numeric(7, 2) DEFAULT ''0'''),
      ('project_wbs_calendars', 'item_count', 'integer DEFAULT 0'),
      ('project_wbs_calendars', 'weighted_progress', 'numeric(7, 2) DEFAULT ''0'''),
      ('project_wbs_calendars', 'note', 'text'),
      ('project_wbs_calendars', 'locked_at', 'timestamp with time zone'),
      ('project_wbs_calendars', 'locked_by_id', 'text'),
      ('project_wbs_calendars', 'created_by_id', 'text'),
      ('project_wbs_calendars', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('project_wbs_calendars', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('projects', 'id', 'text'),
      ('projects', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('projects', 'code', 'text'),
      ('projects', 'title', 'text'),
      ('projects', 'client_id', 'text'),
      ('projects', 'site_id', 'text'),
      ('projects', 'opportunity_id', 'text'),
      ('projects', 'pm_id', 'text'),
      ('projects', 'stage', 'text DEFAULT ''AWAITING_KICKOFF'''),
      ('projects', 'hold', 'text DEFAULT ''NONE'''),
      ('projects', 'contract_number', 'text'),
      ('projects', 'contract_date', 'date'),
      ('projects', 'contract_value', 'numeric(18, 2) DEFAULT ''0'''),
      ('projects', 'contract_value_current', 'numeric(18, 2) DEFAULT ''0'''),
      ('projects', 'contract_ppn', 'numeric(18, 2) DEFAULT ''0'''),
      ('projects', 'retention_pct', 'numeric(5, 2) DEFAULT ''5'''),
      ('projects', 'warranty_months', 'integer DEFAULT 12'),
      ('projects', 'start_date', 'date'),
      ('projects', 'target_end_date', 'date'),
      ('projects', 'bast1_date', 'date'),
      ('projects', 'bast2_date', 'date'),
      ('projects', 'is_locked', 'boolean DEFAULT false'),
      ('projects', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('projects', 'updated_at', 'timestamp with time zone DEFAULT now()'),
      ('punch_items', 'id', 'text'),
      ('punch_items', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('punch_items', 'project_id', 'text'),
      ('punch_items', 'description', 'text'),
      ('punch_items', 'is_closed', 'boolean DEFAULT false'),
      ('punch_items', 'closed_at', 'timestamp with time zone'),
      ('purchase_records', 'id', 'text'),
      ('purchase_records', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('purchase_records', 'project_id', 'text'),
      ('purchase_records', 'supplier_name', 'text'),
      ('purchase_records', 'po_number', 'text'),
      ('purchase_records', 'status', 'text DEFAULT ''DRAFT'''),
      ('purchase_records', 'summary', 'text'),
      ('purchase_records', 'dpp_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('purchase_records', 'ppn_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('purchase_records', 'total_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('purchase_records', 'order_date', 'date'),
      ('purchase_records', 'expected_date', 'date'),
      ('purchase_records', 'budget_line_id', 'text'),
      ('purchase_records', 'received_at', 'timestamp with time zone'),
      ('purchase_records', 'closed_at', 'timestamp with time zone'),
      ('purchase_records', 'created_by_id', 'text'),
      ('purchase_records', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('schedule_items', 'id', 'text'),
      ('schedule_items', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('schedule_items', 'project_id', 'text'),
      ('schedule_items', 'parent_id', 'text'),
      ('schedule_items', 'type', 'text'),
      ('schedule_items', 'name', 'text'),
      ('schedule_items', 'owner_id', 'text'),
      ('schedule_items', 'planned_start', 'date'),
      ('schedule_items', 'planned_end', 'date'),
      ('schedule_items', 'actual_start', 'date'),
      ('schedule_items', 'actual_end', 'date'),
      ('schedule_items', 'weight', 'numeric(5, 2) DEFAULT ''0'''),
      ('schedule_items', 'progress_pct', 'numeric(5, 2) DEFAULT ''0'''),
      ('schedule_items', 'status', 'text DEFAULT ''NOT_STARTED'''),
      ('schedule_items', 'sort_order', 'integer DEFAULT 0'),
      ('schedule_items', 'level', 'integer DEFAULT 1'),
      ('schedule_items', 'code', 'text'),
      ('schedule_items', 'is_summary', 'boolean DEFAULT false'),
      ('schedule_items', 'committed_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('schedule_items', 'planned_pct_per_period', 'numeric(9, 4)'),
      ('schedule_items', 'parent_sort_order', 'integer DEFAULT 0'),
      ('sessions', 'id', 'text'),
      ('sessions', 'company_id', 'uuid'),
      ('sessions', 'last_seen_at', 'timestamp with time zone DEFAULT now()'),
      ('sessions', 'user_id', 'text'),
      ('sessions', 'expires_at', 'timestamp with time zone'),
      ('sessions', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('sites', 'id', 'text'),
      ('sites', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('sites', 'client_id', 'text'),
      ('sites', 'name', 'text'),
      ('sites', 'address', 'text'),
      ('sites', 'contact', 'text'),
      ('sites', 'latitude', 'numeric(10, 7)'),
      ('sites', 'longitude', 'numeric(10, 7)'),
      ('units', 'id', 'text'),
      ('units', 'company_id', 'uuid'),
      ('units', 'code', 'text'),
      ('units', 'name', 'text'),
      ('units', 'created_by_id', 'text'),
      ('units', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('users', 'id', 'text'),
      ('users', 'name', 'text'),
      ('users', 'email', 'text'),
      ('users', 'phone', 'text'),
      ('users', 'password_hash', 'text'),
      ('users', 'role', 'text'),
      ('users', 'title', 'text'),
      ('users', 'is_active', 'boolean DEFAULT true'),
      ('users', 'failed_login_count', 'integer DEFAULT 0'),
      ('users', 'locked_until', 'timestamp with time zone'),
      ('users', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('variation_order_lines', 'id', 'text'),
      ('variation_order_lines', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('variation_order_lines', 'variation_order_id', 'text'),
      ('variation_order_lines', 'action', 'text'),
      ('variation_order_lines', 'budget_type', 'text DEFAULT ''INTERNAL'''),
      ('variation_order_lines', 'budget_line_id', 'text'),
      ('variation_order_lines', 'description', 'text'),
      ('variation_order_lines', 'quantity', 'numeric(18, 4) DEFAULT ''0'''),
      ('variation_order_lines', 'unit_code', 'text DEFAULT ''Ls'''),
      ('variation_order_lines', 'unit_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_order_lines', 'price_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_order_lines', 'cost_amount', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_order_lines', 'sort_order', 'integer DEFAULT 0'),
      ('variation_orders', 'id', 'text'),
      ('variation_orders', 'company_id', 'uuid DEFAULT app_current_company_id()'),
      ('variation_orders', 'project_id', 'text'),
      ('variation_orders', 'code', 'text'),
      ('variation_orders', 'variation_type', 'text'),
      ('variation_orders', 'title', 'text'),
      ('variation_orders', 'reason', 'text'),
      ('variation_orders', 'scope_description', 'text'),
      ('variation_orders', 'price_impact', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_orders', 'cost_impact', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_orders', 'time_impact_days', 'integer DEFAULT 0'),
      ('variation_orders', 'status', 'text DEFAULT ''DRAFT'''),
      ('variation_orders', 'client_reference', 'text'),
      ('variation_orders', 'client_approved_at', 'timestamp with time zone'),
      ('variation_orders', 'client_approved_by', 'text'),
      ('variation_orders', 'evidence_file_id', 'text'),
      ('variation_orders', 'contract_value_before', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_orders', 'contract_value_after', 'numeric(18, 2) DEFAULT ''0'''),
      ('variation_orders', 'cancel_reason', 'text'),
      ('variation_orders', 'implemented_at', 'timestamp with time zone'),
      ('variation_orders', 'created_by_id', 'text'),
      ('variation_orders', 'created_at', 'timestamp with time zone DEFAULT now()'),
      ('variation_orders', 'updated_at', 'timestamp with time zone DEFAULT now()')
    ) AS t(tbl, colname, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = spec.tbl
                      AND column_name = spec.colname) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', spec.tbl, spec.colname, spec.definition);
        INSERT INTO _baseline_warnings (kind, object, detail)
        VALUES ('column_added', spec.tbl || '.' || spec.colname, spec.definition)
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN others THEN
        INSERT INTO _baseline_warnings (kind, object, detail)
        VALUES ('column_skipped', spec.tbl || '.' || spec.colname, SQLERRM)
        ON CONFLICT DO NOTHING;
      END;
    END IF;
  END LOOP;
END $repair$;

-- --------------------------------------------------------------------------
-- Kunci asing: ditambahkan TERPISAH, hanya bila belum ada, dan hanya bila
-- kolom yang dirujuk benar-benar ada. FK ke kolom yang belum ada DILEWATI dan
-- dicatat — bukan menggagalkan seluruh migrasi (database hasil skema lama).
-- --------------------------------------------------------------------------
DO $baseline$
DECLARE
  spec record;
  missing text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('activity_logs', 'activity_logs_actor_id_users_id_fk', 'FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('activity_logs', 'activity_logs_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('auth_events', 'auth_events_company_id_companies_id_fk', 'FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action'),
      ('auth_events', 'auth_events_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('budget_lines', 'budget_lines_budget_version_id_budget_versions_id_fk', 'FOREIGN KEY ("budget_version_id") REFERENCES "public"."budget_versions"("id") ON DELETE cascade ON UPDATE no action'),
      ('budget_lines', 'budget_lines_cost_category_id_cost_categories_id_fk', 'FOREIGN KEY ("cost_category_id") REFERENCES "public"."cost_categories"("id") ON DELETE no action ON UPDATE no action'),
      ('budget_phasing', 'budget_phasing_budget_line_id_budget_lines_id_fk', 'FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE cascade ON UPDATE no action'),
      ('budget_versions', 'budget_versions_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('budget_versions', 'budget_versions_approved_by_id_users_id_fk', 'FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('budget_versions', 'budget_versions_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('change_orders', 'change_orders_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('change_orders', 'change_orders_client_approved_by_users_id_fk', 'FOREIGN KEY ("client_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('change_orders', 'change_orders_evidence_file_id_file_objects_id_fk', 'FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('change_orders', 'change_orders_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('contract_terms', 'contract_terms_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('cost_categories', 'cost_categories_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('customer_invoices', 'customer_invoices_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('customer_invoices', 'customer_invoices_contract_term_id_contract_terms_id_fk', 'FOREIGN KEY ("contract_term_id") REFERENCES "public"."contract_terms"("id") ON DELETE no action ON UPDATE no action'),
      ('customer_invoices', 'customer_invoices_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action'),
      ('customer_payments', 'customer_payments_invoice_id_customer_invoices_id_fk', 'FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE cascade ON UPDATE no action'),
      ('customer_payments', 'customer_payments_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('document_photo_links', 'document_photo_links_document_id_documents_id_fk', 'FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action'),
      ('document_photo_links', 'document_photo_links_field_photo_id_field_photos_id_fk', 'FOREIGN KEY ("field_photo_id") REFERENCES "public"."field_photos"("id") ON DELETE cascade ON UPDATE no action'),
      ('document_photo_links', 'document_photo_links_selected_by_id_users_id_fk', 'FOREIGN KEY ("selected_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('document_template_variables', 'document_template_variables_template_id_document_templates_id_fk', 'FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE cascade ON UPDATE no action'),
      ('document_template_versions', 'document_template_versions_template_id_document_templates_id_fk', 'FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE cascade ON UPDATE no action'),
      ('document_template_versions', 'document_template_versions_docx_file_id_file_objects_id_fk', 'FOREIGN KEY ("docx_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('document_template_versions', 'document_template_versions_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('document_templates', 'document_templates_company_id_companies_id_fk', 'FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action'),
      ('document_templates', 'document_templates_docx_file_id_file_objects_id_fk', 'FOREIGN KEY ("docx_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('document_templates', 'document_templates_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('document_templates', 'document_templates_updated_by_id_users_id_fk', 'FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('documents', 'documents_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('documents', 'documents_template_id_document_templates_id_fk', 'FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE no action ON UPDATE no action'),
      ('documents', 'documents_file_id_file_objects_id_fk', 'FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('documents', 'documents_docx_file_id_file_objects_id_fk', 'FOREIGN KEY ("docx_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('documents', 'documents_archived_by_id_users_id_fk', 'FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('documents', 'documents_uploaded_by_id_users_id_fk', 'FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_lines', 'expense_lines_expense_id_expenses_id_fk', 'FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action'),
      ('expense_lines', 'expense_lines_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_lines', 'expense_lines_cost_category_id_cost_categories_id_fk', 'FOREIGN KEY ("cost_category_id") REFERENCES "public"."cost_categories"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_lines', 'expense_lines_budget_line_id_budget_lines_id_fk', 'FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_lines', 'expense_lines_po_item_id_po_items_id_fk', 'FOREIGN KEY ("po_item_id") REFERENCES "public"."po_items"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_settlements', 'expense_settlements_expense_id_expenses_id_fk', 'FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action'),
      ('expense_settlements', 'expense_settlements_payee_user_id_users_id_fk', 'FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_settlements', 'expense_settlements_proof_file_id_file_objects_id_fk', 'FOREIGN KEY ("proof_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('expense_settlements', 'expense_settlements_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_default_project_id_projects_id_fk', 'FOREIGN KEY ("default_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_purchase_record_id_purchase_records_id_fk', 'FOREIGN KEY ("purchase_record_id") REFERENCES "public"."purchase_records"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_paid_by_user_id_users_id_fk', 'FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_assigned_approver_id_users_id_fk', 'FOREIGN KEY ("assigned_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_receipt_file_id_file_objects_id_fk', 'FOREIGN KEY ("receipt_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('expenses', 'expenses_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('field_photos', 'field_photos_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('field_photos', 'field_photos_file_id_file_objects_id_fk', 'FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE restrict ON UPDATE no action'),
      ('field_photos', 'field_photos_uploaded_by_id_users_id_fk', 'FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('file_objects', 'file_objects_uploaded_by_id_users_id_fk', 'FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('handover_items', 'handover_items_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('invitations', 'invitations_company_id_companies_id_fk', 'FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action'),
      ('invitations', 'invitations_invited_by_users_id_fk', 'FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('memberships', 'memberships_company_id_companies_id_fk', 'FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action'),
      ('memberships', 'memberships_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'),
      ('memberships', 'memberships_invited_by_users_id_fk', 'FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('notifications', 'notifications_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'),
      ('opportunities', 'opportunities_client_id_clients_id_fk', 'FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action'),
      ('opportunities', 'opportunities_site_id_sites_id_fk', 'FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action'),
      ('opportunities', 'opportunities_owner_id_users_id_fk', 'FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('password_reset_tokens', 'password_reset_tokens_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'),
      ('po_items', 'po_items_purchase_record_id_purchase_records_id_fk', 'FOREIGN KEY ("purchase_record_id") REFERENCES "public"."purchase_records"("id") ON DELETE cascade ON UPDATE no action'),
      ('po_items', 'po_items_budget_line_id_budget_lines_id_fk', 'FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action'),
      ('progress_updates', 'progress_updates_schedule_item_id_schedule_items_id_fk', 'FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action'),
      ('progress_updates', 'progress_updates_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('progress_updates', 'progress_updates_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('project_members', 'project_members_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('project_members', 'project_members_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'),
      ('project_wbs_calendars', 'project_wbs_calendars_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('project_wbs_calendars', 'project_wbs_calendars_locked_by_id_users_id_fk', 'FOREIGN KEY ("locked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('project_wbs_calendars', 'project_wbs_calendars_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('projects', 'projects_client_id_clients_id_fk', 'FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action'),
      ('projects', 'projects_site_id_sites_id_fk', 'FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action'),
      ('projects', 'projects_pm_id_users_id_fk', 'FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('punch_items', 'punch_items_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('purchase_records', 'purchase_records_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('purchase_records', 'purchase_records_budget_line_id_budget_lines_id_fk', 'FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE no action ON UPDATE no action'),
      ('purchase_records', 'purchase_records_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('schedule_items', 'schedule_items_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('schedule_items', 'schedule_items_owner_id_users_id_fk', 'FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('sessions', 'sessions_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action'),
      ('sites', 'sites_client_id_clients_id_fk', 'FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action'),
      ('units', 'units_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('variation_order_lines', 'variation_order_lines_variation_order_id_variation_orders_id_fk', 'FOREIGN KEY ("variation_order_id") REFERENCES "public"."variation_orders"("id") ON DELETE cascade ON UPDATE no action'),
      ('variation_orders', 'variation_orders_project_id_projects_id_fk', 'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action'),
      ('variation_orders', 'variation_orders_client_approved_by_users_id_fk', 'FOREIGN KEY ("client_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action'),
      ('variation_orders', 'variation_orders_evidence_file_id_file_objects_id_fk', 'FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action'),
      ('variation_orders', 'variation_orders_created_by_id_users_id_fk', 'FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action')
    ) AS t(tbl, conname, clause)
  LOOP
    SELECT string_agg(col, ', ') INTO missing
      FROM (
        SELECT trim(both ' "' FROM unnest(
                 string_to_array(substring(spec.clause from 'FOREIGN KEY \(([^)]*)\)'), ','))) AS col
      ) parts
     WHERE col <> ''
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND column_name = col);

    IF missing IS NOT NULL THEN
      INSERT INTO _baseline_warnings (kind, object, detail)
      VALUES ('fk_skipped', spec.conname, 'kolom belum ada: ' || missing)
      ON CONFLICT DO NOTHING;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = spec.tbl) THEN
      -- Tabel belum ada; biarkan (FK akan ditambahkan pada jalankan berikutnya).
      NULL;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = left(spec.conname, 63)
                         AND conrelid = to_regclass(format('public.%I', spec.tbl))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I ', spec.tbl, left(spec.conname, 63)) || spec.clause;
    END IF;
  END LOOP;
END $baseline$;

commit;
