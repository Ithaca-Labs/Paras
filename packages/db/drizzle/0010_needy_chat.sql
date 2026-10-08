CREATE TABLE "notification_prefs" (
	"owner_key" text PRIMARY KEY NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"frequency" text DEFAULT 'instant' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"in_app" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupe_uq" UNIQUE("owner_key","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_owner_idx" ON "notifications" USING btree ("owner_key","id");