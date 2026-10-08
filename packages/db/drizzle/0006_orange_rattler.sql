CREATE TABLE "disclosure_acks" (
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_acks_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attested_country" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disclosure_acks" ADD CONSTRAINT "disclosure_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;