import type { EventView } from '@paras/shared';
import { cents } from '@/lib/format';

/** First-Outcome price per Venue, cheapest first. Display only. */
export function venuePrices(event: EventView) {
  return event.markets
    .flatMap((m) => {
      const o = m.outcomes[0];
      const p = o?.quote?.last ?? o?.quote?.ask;
      return p == null
        ? []
        : [{ id: m.id, venue: m.venue.name, label: o!.label, price: Number(p), stale: m.stale }];
    })
    .sort((a, b) => a.price - b.price);
}

const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;

/**
 * The ink odds line: a 0–100¢ rule with each Venue's price stamped on it as a seal. The ink
 * stroke runs to the cheapest price; the disagreement between Venues is washed in terracotta.
 */
export function OddsLine({ event, size = 'sm' }: { event: EventView; size?: 'sm' | 'lg' }) {
  const prices = venuePrices(event);
  if (prices.length === 0) return <div className="h-px bg-border" />;
  const lo = prices[0]!.price;
  const hi = prices.at(-1)!.price;
  const lg = size === 'lg';
  return (
    <div className={lg ? 'pt-8' : ''}>
      <div className={`relative ${lg ? 'h-1' : 'h-[3px]'} rounded-full bg-border/70`}>
        <span
          className="ink-stroke absolute inset-y-0 left-0 rounded-full bg-fg"
          style={{ width: pct(lo) }}
        />
        {hi > lo && (
          <span
            className="spread-wash absolute inset-y-0 bg-seal/45"
            style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
          />
        )}
        {prices.map((p, i) => (
          <span
            key={p.id}
            tabIndex={lg ? 0 : -1}
            aria-label={`${p.venue}: ${p.label} ${cents(String(p.price))}`}
            className={`seal group absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-seal ring-2 ring-surface ${lg ? 'size-3.5' : 'size-2.5'}`}
            style={{ left: pct(p.price), animationDelay: `${450 + i * 90}ms` }}
          >
            {lg && (
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-sm bg-fg px-2 py-1 font-mono text-[0.65rem] whitespace-nowrap text-bg opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                {p.venue} {cents(String(p.price))}
              </span>
            )}
          </span>
        ))}
      </div>
      {lg && (
        <div className="mt-2 flex justify-between font-mono text-[0.625rem] text-muted">
          <span>0¢</span>
          {hi > lo && (
            <span className="text-negative">Venues differ by {Math.round((hi - lo) * 100)}¢</span>
          )}
          <span>100¢</span>
        </div>
      )}
    </div>
  );
}
