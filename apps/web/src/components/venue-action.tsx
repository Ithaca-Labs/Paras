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
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium whitespace-nowrap hover:border-fg/40 hover:bg-surface-2"
    >
      Bet on {venueName} ↗
    </a>
  );
  if (availability === 'routable') {
    return (
      <span className="flex flex-wrap justify-end gap-2">
        <a
          href="#bet"
          className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium whitespace-nowrap text-accent-fg hover:brightness-110"
        >
          Bet with Vault
        </a>
        {link}
      </span>
    );
  }
  return link;
}
