import type { MarketView } from '@paras/shared';
import { VenueLabel } from './venue-label';

/** Side-by-side resolution rules per Venue, with the low-confidence match warning. */
export function RulesCompare({ markets }: { markets: MarketView[] }) {
  const low = markets.filter((m) => m.lowConfidence);
  return (
    <section aria-labelledby="rules-h" className="flex flex-col gap-3">
      <h2 id="rules-h" className="text-lg font-medium">
        Resolution rules
      </h2>
      {low.length > 0 && (
        <p role="alert" className="rounded-card border border-warning p-3 text-sm text-warning">
          Low-confidence match: {low.map((m) => m.venue.name).join(', ')} may not resolve exactly
          like the other Venues. Compare the rules below before betting.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {markets.map((m) => (
          <article
            key={m.id}
            className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
          >
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{m.venue.name}</h3>
              <VenueLabel label={m.venue.label} />
              {m.lowConfidence && <span className="text-xs text-warning">low match</span>}
              {m.direction === 'inverse' && (
                <span className="text-xs text-muted">inverse Outcomes</span>
              )}
            </header>
            <p className="text-sm">{m.question}</p>
            <p className="whitespace-pre-line text-sm text-muted">
              {m.rules || 'No rules published.'}
            </p>
            <p className="text-xs text-muted">
              Source: {m.resolutionSource ?? 'not stated'} · Match{' '}
              {Math.round(Number(m.matchConfidence) * 100)}% ({m.matchSource})
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
