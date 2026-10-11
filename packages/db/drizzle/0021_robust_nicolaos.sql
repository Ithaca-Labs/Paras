CREATE TABLE "conditional_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"event_id" uuid,
	"outcome" text,
	"amount_usdc" text,
	"position_id" uuid,
	"shares" text,
	"trigger_price" text NOT NULL,
	"limit_price" text,
	"ip_country" text,
	"expires_at" timestamp with time zone,
	"intent_row_id" uuid,
	"exit_id" uuid,
	"reason" text,
	"triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conditional_orders" ADD CONSTRAINT "conditional_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_orders" ADD CONSTRAINT "conditional_orders_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conditional_orders_status_idx" ON "conditional_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conditional_orders_user_idx" ON "conditional_orders" USING btree ("user_id");