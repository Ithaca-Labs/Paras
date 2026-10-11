CREATE TABLE "nansen_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_money_signals" (
	"market_id" uuid PRIMARY KEY NOT NULL,
	"signal" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "smart_money_signals" ADD CONSTRAINT "smart_money_signals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;