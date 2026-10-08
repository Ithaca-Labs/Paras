CREATE TABLE "chain_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"block" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_row_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_address" text NOT NULL,
	"intent_id" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"details_hash" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"ctx" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intents_user_intent_uq" UNIQUE("user_address","intent_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_events" ADD CONSTRAINT "intent_events_intent_row_id_intents_id_fk" FOREIGN KEY ("intent_row_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_requests" ADD CONSTRAINT "wallet_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_events_intent_idx" ON "intent_events" USING btree ("intent_row_id","id");--> statement-breakpoint
CREATE INDEX "intents_status_idx" ON "intents" USING btree ("status");