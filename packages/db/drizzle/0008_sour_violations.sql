CREATE TABLE "interest_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_token_hash" text,
	"status" text NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"entities" text[] DEFAULT '{}'::text[] NOT NULL,
	"free_text" text[] DEFAULT '{}'::text[] NOT NULL,
	"experience" text,
	"risk_appetite" text,
	"stake_size" text,
	"horizon" text,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "interest_profiles_anon_token_hash_unique" UNIQUE("anon_token_hash")
);
--> statement-breakpoint
ALTER TABLE "interest_profiles" ADD CONSTRAINT "interest_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;