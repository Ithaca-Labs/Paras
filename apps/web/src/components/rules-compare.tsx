import type { MarketView } from '@paras/shared';
import { plainText } from '@/lib/format';
import { VenueLabel } from './venue-label';

/** Side-by-side resolution rules per Venue, with the low-confidence match warning. */
export function RulesCompare({ markets }: { markets: MarketView[] }) {
  const low = markets.filter((m) => m.lowConfidence);
  return (
    <section aria-labelledby="rules-h" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="rules-h" className="text-2xl">
          Resolution rules
        </h2>
        <p className="text-xs text-muted">How each Venue settles this question</p>
      </div>
      {low.length > 0 && (
        <p
          role="alert"
          className="flex gap-3 rounded-card border border-gold/60 bg-gold/10 p-4 text-sm text-warning"
        >
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-full bg-gold text-xs font-bold text-[#1e2b3f]"
          >
            !
          </span>
          <span>
            Low-confidence match: {low.map((m) => m.venue.name).join(', ')} may not resolve exactly
            like the other Venues. Compare the rules below before betting.
          </span>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {markets.map((m) => {
          const rules = plainText(m.rules);
          const match = Math.round(Number(m.matchConfidence) * 100);
          return (
            <article
              key={m.id}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5"
            >
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-bold">{m.venue.name}</h3>
                <VenueLabel label={m.venue.label} />
                {m.direction === 'inverse' && (
                  <span className="text-xs text-muted">inverse Outcomes</span>
                )}
              </header>
              <p className="text-sm font-medium">{m.question}</p>
              <details className="group text-sm leading-relaxed text-muted">
                <summary className="cursor-pointer list-none">
                  <span className="line-clamp-5 whitespace-pre-line group-open:line-clamp-none">
                    {rules || 'No rules published.'}
                  </span>
                  {rules.length > 280 && (
                    <span className="mt-2 inline-block text-xs font-medium text-accent group-open:hidden">
                      Show full rules
                    </span>
                  )}
                </summary>
              </details>
              <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 pt-3 text-xs text-muted">
                <span>Source: {m.resolutionSource ?? 'not stated'}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 ${
                    m.lowConfidence ? 'bg-gold/15 text-warning' : 'bg-accent/10 text-accent'
                  }`}
                >
                  Match {match}% · {m.matchSource}
                </span>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
