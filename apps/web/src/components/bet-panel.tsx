/**
 * Vault Bet panel slot. PLACEHOLDER: #30 / #109 replace this component's body (keep the name and
 * `eventId` prop; the Event page mounts it at `#bet`). Redirect buttons live in the comparison table.
 */
export function BetPanel({ eventId }: { eventId: string }) {
  return (
    <section
      id="bet"
      data-event-id={eventId}
      className="rounded-card border border-dashed border-border p-4 text-sm text-muted"
    >
      Vault betting coming soon. Use the Venue buttons above to bet on the Venue&apos;s own site.
    </section>
  );
}
