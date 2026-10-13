import type { Availability } from '@paras/shared';

/**
 * Jurisdiction-aware action for one Venue, from the API's per-caller `availability`:
 * routable -> Vault bet (BetPanel) + Venue link; redirect -> "Bet on <Venue>" on its own site;
 * blocked -> unavailable. The redirect never depends on the Vault (Kalshi is redirect-only).
 */
export function VenueAction({
  venueName,
  availability,
  redirectUrl,
}: {
  venueName: string;
  availability: Availability;
  redirectUrl: string;
}) {
  if (availability === 'blocked') {
    return <span className="text-xs text-muted">Not available in your region</span>;
  }
  const link = (
    <a
      href={redirectUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-surface-2"
    >
      Bet on {venueName} ↗
    </a>
  );
  if (availability === 'routable') {
    return (
      <span className="flex flex-wrap gap-2">
        <a href="#bet" className="rounded-sm bg-accent px-3 py-1.5 text-xs text-accent-fg">
          Bet with Vault
        </a>
        {link}
      </span>
    );
  }
  return link;
}
