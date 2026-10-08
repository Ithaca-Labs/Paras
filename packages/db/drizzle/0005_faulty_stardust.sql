CREATE TABLE "event_tags" (
	"event_id" uuid NOT NULL,
	"tag_id" text NOT NULL,
	"kind" text NOT NULL,
	"score" numeric NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "event_tags_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "liquidity" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "move_24h" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "trending_score" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "embedded_hash" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_tags_tag_idx" ON "event_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "events_search_tsv_idx" ON "events" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "events_embedding_idx" ON "events" USING hnsw ("embedding" vector_cosine_ops);