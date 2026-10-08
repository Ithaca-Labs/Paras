CREATE TABLE "executor_pauses" (
	"scope" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"paused_by" uuid,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "executor_pauses" ADD CONSTRAINT "executor_pauses_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_runs" ADD CONSTRAINT "venue_runs_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_runs_venue_at_idx" ON "venue_runs" USING btree ("venue_id","at");