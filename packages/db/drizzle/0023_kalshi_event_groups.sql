-- #133: Kalshi Markets are grouped per Kalshi event on the next sync (lone Events fold into one; ids, Magic Links and follows kept). Rescan lone Events so other Venues' Markets match the new group Events.
UPDATE "events" SET "matched_hash" = NULL;
