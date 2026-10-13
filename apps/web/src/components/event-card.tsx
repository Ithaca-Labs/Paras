import type { EventView } from '@paras/shared';
import Image from 'next/image';
import Link from 'next/link';
import { cents, usd } from '@/lib/format';
import { OddsLine, venuePrices } from './odds-line';

/** Category -> brand ornament (brand-assets/assets.png). */
const ORNAMENT: [RegExp, string][] = [
  [/polit|election|gov/, 'temple'],
  [/sport|esport|game/, 'pine'],
  [/crypto|defi|token/, 'seigaiha'],
  [/econ|financ|macro|business/, 'mountain'],
  [/tech|ai|science|health/, 'chrysanthemum'],
  [/culture|entertain|music|film/, 'sakura'],
];
/** "YES" -> "Yes". */
const outcome = (l: string) => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();

const ornament = (category: string | null) =>
  ORNAMENT.find(([re]) => re.test(category?.toLowerCase() ?? ''))?.[1] ?? 'cloud';

/**
 * One Event with its cross-Venue Quotes. Pure presentational: pass an `EventView` from the API.
 * Leads with the cheapest first-Outcome price (usually YES), then each Venue's price.
 */
export function EventCard({ event, reason }: { event: EventView; reason?: string }) {
  const prices = venuePrices(event);
  const best = prices[0];
  const gap = prices.length > 1 ? Math.round((prices.at(-1)!.price - best!.price) * 100) : 0;
  return (
    <article className="slip scroll-frame group flex flex-col overflow-hidden rounded-card border border-gold/60 bg-surface p-6">
      <Image
        src={`/brand/ornaments/${ornament(event.category)}.png`}
        alt=""
        width={400}
        height={270}
        className="ornament pointer-events-none absolute -top-3 -right-6 w-36 opacity-80"
      />
      <p className="relative mb-2 flex items-center gap-2 pr-24 font-display text-[0.7rem] tracking-[0.22em] text-muted uppercase">
        <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-seal" />
        {event.category ?? 'Event'}
      </p>
      {reason && <p className="relative mb-1 pr-24 text-xs text-muted">{reason}</p>}
      <h3 className="relative pr-16 font-display text-lg leading-snug font-bold text-balance">
        <Link
          href={`/events/${event.id}`}
          className="after:absolute after:-inset-[999px] after:content-[''] focus-visible:outline-none"
        >
          {event.title}
        </Link>
      </h3>

      <div className="mt-auto pt-6">
        <div className="rounded-xl border border-border/70 bg-surface-2/50 p-4">
          {best ? (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-display text-[2.5rem] leading-none font-extrabold tracking-tight tabular-nums">
                  {cents(String(best.price))}
                </span>
                <span className="flex flex-col text-xs leading-tight">
                  <span className="font-medium">{outcome(best.label)}</span>
                  <span className="text-muted">Best price</span>
                </span>
              </div>
              {gap > 0 && (
                <span className="stamp-badge rounded-full border border-seal/50 px-2.5 py-1 text-[0.7rem] font-medium text-negative">
                  {gap}¢ apart
                </span>
              )}
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">No live price yet</p>
          )}
          <OddsLine event={event} />
          {prices.length > 0 && (
            <ul className="mt-4 space-y-2 text-[0.8125rem]">
              {prices.slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      title={p.stale ? 'Price may be out of date' : undefined}
                      className={`size-1.5 shrink-0 rounded-full ${p.stale ? 'bg-gold' : 'bg-positive'}`}
                    />
                    <span className="truncate">{p.venue}</span>
                    {p.stale && <span className="sr-only">(price may be out of date)</span>}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {cents(String(p.price))}
                  </span>
                </li>
              ))}
              {prices.length > 3 && (
                <li className="pl-3.5 text-xs text-muted">+{prices.length - 3} more Venues</li>
              )}
            </ul>
          )}
        </div>
        <footer className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>{usd(event.volume)} traded</span>
          <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-medium text-fg transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-accent-fg">
            Compare
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </footer>
      </div>
    </article>
  );
}
