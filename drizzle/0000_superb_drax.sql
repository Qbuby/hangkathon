CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'online' NOT NULL,
	"venue" text DEFAULT '' NOT NULL,
	"pricing" text DEFAULT 'free' NOT NULL,
	"fee" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'creation' NOT NULL,
	"prize_pool" integer DEFAULT 0 NOT NULL,
	"starts_at" text DEFAULT '' NOT NULL,
	"ends_at" text DEFAULT '' NOT NULL,
	"submission_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judging" text DEFAULT 'judges' NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"awards_enabled" boolean DEFAULT false NOT NULL,
	"awards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"join_policy" text DEFAULT 'anyone' NOT NULL,
	"email_domain" text DEFAULT '' NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"faction_id" text NOT NULL,
	"team_id" text,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_events" ADD CONSTRAINT "invite_events_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_events" ADD CONSTRAINT "invite_events_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_events" ADD CONSTRAINT "invite_events_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joins" ADD CONSTRAINT "joins_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joins" ADD CONSTRAINT "joins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joins" ADD CONSTRAINT "joins_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_slug_unique" ON "activities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "invite_events_activity_idx" ON "invite_events" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "joins_activity_user_unique" ON "joins" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE INDEX "joins_user_idx" ON "joins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_activity_user_idx" ON "submissions" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");