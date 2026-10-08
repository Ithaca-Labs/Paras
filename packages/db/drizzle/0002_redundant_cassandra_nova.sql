CREATE TABLE "event_markets" (
	"event_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"confidence" numeric DEFAULT '1' NOT NULL,
	"direction" text DEFAULT 'same' NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	CONSTRAINT "event_markets_event_id_market_id_pk" PRIMARY KEY("event_id","market_id"),
	CONSTRAINT "event_markets_market_id_unique" UNIQUE("market_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"status" text NOT NULL,
	"end_date" timestamp with time zone,
	"image_url" text,
	"volume" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "latest_quotes" (
	"outcome_id" uuid PRIMARY KEY NOT NULL,
	"bid" numeric,
	"ask" numeric,
	"last" numeric,
	"bid_depth" numeric NOT NULL,
	"ask_depth" numeric NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text,
	"question" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"resolution_source" text,
	"category" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"end_date" timestamp with time zone,
	"volume" numeric DEFAULT '0' NOT NULL,
	"liquidity" numeric DEFAULT '0' NOT NULL,
	"image_url" text,
	"url" text NOT NULL,
	"fee" jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_venue_external_uq" UNIQUE("venue_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"index" integer NOT NULL,
	CONSTRAINT "outcomes_market_external_uq" UNIQUE("market_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "quote_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outcome_id" uuid NOT NULL,
	"bid" numeric,
	"ask" numeric,
	"last" numeric,
	"bid_depth" numeric NOT NULL,
	"ask_depth" numeric NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_markets" ADD CONSTRAINT "event_markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_markets" ADD CONSTRAINT "event_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_status_volume_idx" ON "events" USING btree ("status","volume");--> statement-breakpoint
CREATE INDEX "markets_venue_status_volume_idx" ON "markets" USING btree ("venue_id","status","volume");--> statement-breakpoint
CREATE INDEX "quote_snapshots_outcome_time_idx" ON "quote_snapshots" USING btree ("outcome_id","observed_at");