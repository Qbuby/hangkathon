CREATE TABLE IF NOT EXISTS "agent_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_applications_user_unique" UNIQUE("user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_applications_status_idx" ON "agent_applications" ("status");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;