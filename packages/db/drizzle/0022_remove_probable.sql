-- #128: Probable is no longer a Venue. Drop its Events (only those made solely of Probable Markets and not behind a Magic Link), Markets (cascades Outcomes, Quotes, event links), runs and the Venue row.
DELETE FROM "events" WHERE "id" IN (
  SELECT em."event_id" FROM "event_markets" em JOIN "markets" m ON m."id" = em."market_id"
  GROUP BY em."event_id" HAVING bool_and(m."venue_id" = 'probable')
) AND "id" NOT IN (SELECT "event_id" FROM "magic_links");--> statement-breakpoint
DELETE FROM "markets" WHERE "venue_id" = 'probable';--> statement-breakpoint
DELETE FROM "venue_runs" WHERE "venue_id" = 'probable';--> statement-breakpoint
DELETE FROM "venues" WHERE "id" = 'probable';
