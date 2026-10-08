CREATE TABLE "deposit_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"owner_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"salt" text NOT NULL,
	"chain_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deploy_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_at" timestamp with time zone,
	CONSTRAINT "deposit_wallets_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "executor_session_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"address" text NOT NULL,
	"ciphertext" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "executor_session_keys_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "intent_funding" (
	"intent_id" text PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"cap_usdc" text NOT NULL,
	"funded_usdc" text DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_wallets" ADD CONSTRAINT "deposit_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executor_session_keys" ADD CONSTRAINT "executor_session_keys_wallet_id_deposit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."deposit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_funding" ADD CONSTRAINT "intent_funding_wallet_id_deposit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."deposit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_wallets_user_chain_idx" ON "deposit_wallets" USING btree ("user_id","chain_id");--> statement-breakpoint
CREATE INDEX "executor_session_keys_wallet_idx" ON "executor_session_keys" USING btree ("wallet_id","status");