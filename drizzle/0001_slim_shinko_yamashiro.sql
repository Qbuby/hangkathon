ALTER TABLE "submissions" ADD COLUMN "aweme_id" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "digg_count" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "comment_count" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "share_count" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "collect_count" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "metrics_error" text;