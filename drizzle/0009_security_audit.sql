ALTER TABLE "users" ADD COLUMN "real_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "real_name_status" text NOT NULL DEFAULT 'unverified';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_ip" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"ip" text,
	"port" text,
	"protocol" text,
	"user_agent" text,
	"method" text,
	"path" text,
	"status" integer,
	"target_type" text,
	"target_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb,
	"result" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text,
	"hash" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_idx" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_category_idx" ON "audit_logs" ("category");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT 'platform' NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blacklist_email_unique" UNIQUE("email")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_blacklist_effective_idx" ON "user_blacklist" ("effective_from");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blacklist" ADD CONSTRAINT "user_blacklist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_blacklist" ADD CONSTRAINT "user_blacklist_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $audit$
BEGIN
	RAISE EXCEPTION 'audit_logs is append-only: UPDATE/DELETE are rejected by policy 8.4.4';
END;
$audit$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_mutation ON "audit_logs";--> statement-breakpoint
CREATE TRIGGER audit_logs_no_mutation BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
