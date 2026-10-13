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
        {best ? (
          <div className="mb-4 flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-4xl leading-none font-extrabold tabular-nums">
                {cents(String(best.price))}
              </span>
              <span className="text-xs text-muted">{best.label} · best price</span>
            </p>
            {gap > 0 && (
              <span className="stamp-badge rounded-[3px] border-2 border-seal px-2 py-0.5 font-display text-xs font-bold text-negative">
                {gap}¢ apart
              </span>
            )}
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted">No live price yet</p>
        )}
        <OddsLine event={event} />
        {prices.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-[0.8rem]">
            {prices.slice(0, 3).map((p) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className={p.stale ? 'text-muted' : ''}>{p.venue}</span>
                {p.stale && <span className="text-[0.65rem] text-warning">stale</span>}
                <span
                  aria-hidden
                  className="flex-1 translate-y-[-3px] border-b border-dotted border-gold"
                />
                <span className="font-mono tabular-nums">{cents(String(p.price))}</span>
              </li>
            ))}
            {prices.length > 3 && (
              <li className="text-[0.7rem] text-muted">+{prices.length - 3} more Venues</li>
            )}
          </ul>
        )}
        <footer className="mt-5 flex items-center gap-3 text-[0.7rem] text-muted">
          <span>{usd(event.volume)} traded</span>
          <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-gold/70 to-transparent" />
          <span className="flex items-center gap-1 font-medium transition-colors group-hover:text-accent">
            Compare
            <span aria-hidden className="transition-transform group-hover:translate-x-1">
              →
            </span>
          </span>
        </footer>
      </div>
    </article>
  );
}
