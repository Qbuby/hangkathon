CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"category" text DEFAULT 'competition' NOT NULL,
	"location" text,
	"online" boolean,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"prize" text,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_events_source_external_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE INDEX "external_events_starts_idx" ON "external_events" ("starts_at");
