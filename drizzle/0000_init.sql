CREATE TYPE "public"."attempt_kind" AS ENUM('call', 'visit', 'message');--> statement-breakpoint
CREATE TYPE "public"."contact_channel" AS ENUM('visit', 'call');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('overdue', 'cured', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('sent_simulated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."outcome_type" AS ENUM('paid', 'promise', 'not_reachable', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."promise_status" AS ENUM('open', 'kept', 'broken', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('officer', 'manager', 'head');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "borrowers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"pincode" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"business_type" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'hi' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"officer_id" uuid NOT NULL,
	"kind" "attempt_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"allowed" boolean NOT NULL,
	"blocked_reason" text,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" date NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" uuid,
	"row_count" integer NOT NULL,
	"accepted" integer NOT NULL,
	"rejected" integer NOT NULL,
	"new_loans" integer NOT NULL,
	"cured_loans" integer NOT NULL,
	"unassigned" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_snapshots" (
	"loan_id" text NOT NULL,
	"as_of_date" date NOT NULL,
	"dpd" integer NOT NULL,
	"outstanding" integer NOT NULL,
	"branch_id" text NOT NULL,
	"officer_id" uuid,
	CONSTRAINT "loan_snapshots_loan_id_as_of_date_pk" PRIMARY KEY("loan_id","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"borrower_id" uuid NOT NULL,
	"branch_id" text NOT NULL,
	"emi" integer NOT NULL,
	"outstanding" integer NOT NULL,
	"dpd" integer NOT NULL,
	"last_payment_date" date,
	"paid_ratio_6m" double precision,
	"disbursed_on" date,
	"status" "loan_status" DEFAULT 'overdue' NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"assigned_officer_id" uuid,
	"assignment_reason" text,
	"assigned_at" timestamp with time zone,
	"manual_rank" integer,
	"manual_rank_by" uuid,
	"last_import_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"officer_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" NOT NULL,
	"blocked_reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officer_territories" (
	"officer_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	CONSTRAINT "officer_territories_officer_id_pincode_pk" PRIMARY KEY("officer_id","pincode")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"officer_id" uuid NOT NULL,
	"type" "outcome_type" NOT NULL,
	"channel" "contact_channel" NOT NULL,
	"reason" text,
	"amount" integer,
	"promised_date" date,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"clock_skew_ms" integer DEFAULT 0 NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" double precision,
	"gps_status" text NOT NULL,
	"created_offline" boolean DEFAULT false NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" text NOT NULL,
	"outcome_id" uuid,
	"officer_id" uuid NOT NULL,
	"promised_date" date NOT NULL,
	"amount" integer NOT NULL,
	"status" "promise_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"loan_id" text NOT NULL,
	"as_of_date" date NOT NULL,
	"score" integer NOT NULL,
	"p_roll" double precision NOT NULL,
	"reasons" jsonb NOT NULL,
	"limited_history" boolean DEFAULT false NOT NULL,
	"model_version" text NOT NULL,
	CONSTRAINT "score_snapshots_loan_id_as_of_date_pk" PRIMARY KEY("loan_id","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"branch_id" text,
	"password_hash" text NOT NULL,
	"language" text DEFAULT 'hi' NOT NULL,
	"max_load" integer DEFAULT 25 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_snapshots" ADD CONSTRAINT "loan_snapshots_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrower_id_borrowers_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."borrowers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_assigned_officer_id_users_id_fk" FOREIGN KEY ("assigned_officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_manual_rank_by_users_id_fk" FOREIGN KEY ("manual_rank_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_territories" ADD CONSTRAINT "officer_territories_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attempts_loan_idx" ON "contact_attempts" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "attempts_officer_idx" ON "contact_attempts" USING btree ("officer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "snap_date_idx" ON "loan_snapshots" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "loans_officer_idx" ON "loans" USING btree ("assigned_officer_id");--> statement-breakpoint
CREATE INDEX "loans_branch_status_idx" ON "loans" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "messages_loan_idx" ON "messages" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "territory_pincode_idx" ON "officer_territories" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "outcomes_loan_idx" ON "outcomes" USING btree ("loan_id","occurred_at");--> statement-breakpoint
CREATE INDEX "outcomes_officer_idx" ON "outcomes" USING btree ("officer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "promises_loan_idx" ON "promises" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "promises_status_date_idx" ON "promises" USING btree ("status","promised_date");--> statement-breakpoint
CREATE INDEX "score_date_idx" ON "score_snapshots" USING btree ("as_of_date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");