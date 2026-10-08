CREATE TABLE "feed_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"owner_key" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_owner_key_kind_target_id_pk" PRIMARY KEY("owner_key","kind","target_id")
);
--> statement-breakpoint
ALTER TABLE "feed_signals" ADD CONSTRAINT "feed_signals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_signals_owner_idx" ON "feed_signals" USING btree ("owner_key","created_at");