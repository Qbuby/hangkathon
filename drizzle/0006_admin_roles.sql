ALTER TABLE "users" ADD COLUMN "role" text NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "review_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "reviewed_at" timestamp with time zone;
