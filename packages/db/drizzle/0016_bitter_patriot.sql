CREATE TABLE "chain_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"asset" text NOT NULL,
	"delta" numeric NOT NULL,
	"block" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"shares" text,
	"min_price" text,
	"return_to" text NOT NULL,
	"ctx" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_row_id" uuid NOT NULL,
	"user_address" text NOT NULL,
	"event_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"venue_id" text NOT NULL,
	"token_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"neg_risk" boolean DEFAULT false NOT NULL,
	"shares_bought" text NOT NULL,
	"shares" text NOT NULL,
	"cost_usdc" text NOT NULL,
	"return_to" text DEFAULT 'vault' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_intent_row_id_unique" UNIQUE("intent_row_id")
);
--> statement-breakpoint
CREATE TABLE "vault_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_address" text NOT NULL,
	"kind" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exits" ADD CONSTRAINT "exits_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exits" ADD CONSTRAINT "exits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_intent_row_id_intents_id_fk" FOREIGN KEY ("intent_row_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_transfers_uq" ON "chain_transfers" USING btree ("tx_hash","log_index","asset","wallet");--> statement-breakpoint
CREATE INDEX "chain_transfers_wallet_idx" ON "chain_transfers" USING btree ("wallet","asset");--> statement-breakpoint
CREATE INDEX "exits_position_idx" ON "exits" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exits_active_uq" ON "exits" USING btree ("position_id") WHERE "exits"."status" not in ('done', 'failed');--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_activity_uq" ON "vault_activity" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "vault_activity_user_idx" ON "vault_activity" USING btree ("user_address","at");