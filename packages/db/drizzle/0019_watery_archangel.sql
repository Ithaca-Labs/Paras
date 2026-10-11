CREATE TABLE "delegations" (
	"wallet_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"policy_id" text NOT NULL,
	"signer_id" text NOT NULL,
	"max_intent_usdc" text NOT NULL,
	"cap_usdc" text NOT NULL,
	"spent_usdc" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privy_wallets" (
	"wallet_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"privy_user_id" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privy_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_wallet_id_privy_wallets_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."privy_wallets"("wallet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privy_wallets" ADD CONSTRAINT "privy_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;