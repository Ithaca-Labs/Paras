ALTER TABLE "exits" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "exits" ADD CONSTRAINT "exits_signature_unique" UNIQUE("signature");