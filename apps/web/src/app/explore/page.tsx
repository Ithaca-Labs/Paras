import Image from 'next/image';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { EventCard } from '@/components/event-card';
import { Handscroll } from '@/components/handscroll';
import { OddsLine, venuePrices } from '@/components/odds-line';
import { EmptyState } from '@/components/states';
import { VenueLabel } from '@/components/venue-label';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Explore' };

// Always reads live Quotes.
export const dynamic = 'force-dynamic';

const SORTS = [
  ['trending', 'Trending'],
  ['volume', 'Volume'],
  ['closing_soon', 'Closing soon'],
  ['newest', 'Newest'],
  ['biggest_move', 'Biggest move'],
] as const;
const FILTER_KEYS = [
  'q',
  'status',
  'venue',
  'category',
  'topic',
  'entity',
  'sort',
  'minLiquidity',
  'includePlayMoney',
] as const;
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k])])) as Record<
    (typeof FILTER_KEYS)[number],
    string | undefined
  >;
  const cursor = one(sp.cursor);
  const api = serverApi();
  const [list, venues, cats] = await Promise.all([
    api.listEvents({
      query: {
        limit: 24,
        cursor,
        q: f.q,
        status: (f.status as 'open' | 'closed' | 'resolved' | 'all') ?? 'open',
        venue: f.venue,
        category: f.category,
        topic: f.topic,
        entity: f.entity,
        sort: f.sort as (typeof SORTS)[number][0] | 'relevance' | undefined,
        minLiquidity: f.minLiquidity ? Number(f.minLiquidity) : undefined,
        includePlayMoney: f.includePlayMoney === 'true' ? 'true' : 'false',
      },
    }),
    api.listVenues(),
    api.listCategories(),
  ]);

  const href = (over: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...over })) if (v) qs.set(k, v);
    return `/explore${qs.size ? `?${qs}` : ''}`;
  };
  const field =
    'pill-field h-9 appearance-none rounded-full border border-border bg-bg/70 px-4 text-sm text-muted hover:border-fg/40 hover:text-fg focus:border-accent focus:outline-none';
  const tab = (on: boolean) =>
    `flex items-center gap-2 rounded-full border px-3.5 py-1.5 whitespace-nowrap transition ${
      on
        ? 'border-fg bg-fg text-bg before:size-1.5 before:rounded-full before:bg-seal'
        : 'border-transparent text-muted hover:border-border hover:bg-surface hover:text-fg'
    }`;
  const activeCat = cats.items.find((c) => c.id === f.category);
  const browsing = !f.q && !f.category && !f.topic && !f.entity && !cursor;
  // Widest cross-Venue disagreement on this page (display only).
  const spread = (e: (typeof list.items)[number]) => {
    const p = venuePrices(e).map((v) => v.price);
    return p.length > 1 ? Math.max(...p) - Math.min(...p) : -1;
  };
  const featured = [...list.items].sort((a, b) => spread(b) - spread(a))[0];

  return (
    <>
      {browsing && featured ? (
        <Handscroll>
          <div className="relative grid items-center gap-8 px-6 pt-6 pb-8 md:grid-cols-[1.15fr_1fr] md:gap-12 md:px-10 md:pb-10">
            <Image
              src="/brand/cloud.png"
              alt=""
              width={330}
              height={230}
              className="drift pointer-events-none absolute -bottom-8 left-1/3 w-56 opacity-25"
            />
            <div className="fade-up relative" style={{ animationDelay: '500ms' }}>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/60 bg-bg/60 px-3 py-1 text-xs text-muted">
                <span aria-hidden className="size-1.5 rounded-full bg-seal" />
                {venues.items.length} Venues, compared live
              </p>
              <h1 className="text-[2.6rem] leading-[1.05] font-extrabold text-balance md:text-[3rem]">
                One question.
                <br />
                <span className="text-accent">Every Venue&rsquo;s price.</span>
              </h1>
              <p className="mt-4 max-w-md leading-relaxed text-muted">
                See where the odds disagree before you bet.
              </p>
            </div>
            <Link
              href={`/events/${featured.id}`}
              className="fade-up slip scroll-frame group relative block rounded-card border border-gold/60 bg-surface p-6 shadow-[0_18px_40px_-28px_rgb(30_43_63/0.45)]"
              style={{ animationDelay: '700ms' }}
            >
              <p className="flex items-center justify-between gap-3 text-xs text-muted">
                <span className="flex items-center gap-2 font-display tracking-[0.18em] uppercase">
                  <span aria-hidden className="size-2 rounded-[2px] bg-seal" />
                  {spread(featured) > 0 ? 'Widest disagreement' : 'Most traded'}
                </span>
                <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                  →
                </span>
              </p>
              <p className="mt-3 font-display text-xl leading-snug font-bold text-balance">
                {featured.title}
              </p>
              <OddsLine event={featured} size="lg" />
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {venuePrices(featured).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1"
                  >
                    {p.venue}
                    <span className="font-mono font-medium">{Math.round(p.price * 100)}¢</span>
                  </li>
                ))}
              </ul>
            </Link>
          </div>
        </Handscroll>
      ) : (
        <PageHeader title="Explore">Search and compare prices across Venues.</PageHeader>
      )}

      <form
        method="get"
        role="search"
        className="mb-5 rounded-card border border-border bg-surface/80 p-3 shadow-[0_10px_30px_-24px_rgb(30_43_63/0.5)] backdrop-blur-sm"
      >
        <div className="flex items-center gap-3 rounded-full border border-border bg-bg/70 py-1.5 pr-1.5 pl-5 transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="m13.5 13.5 4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <input
            name="q"
            defaultValue={f.q}
            placeholder="Search Events, e.g. Fed rate cut"
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base placeholder:text-muted/70 focus:outline-none"
          />
          <button className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-fg hover:brightness-110">
            Search
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          <select name="sort" defaultValue={f.sort ?? ''} aria-label="Sort" className={field}>
            <option value="">{f.q ? 'Relevance' : 'Volume'}</option>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select name="venue" defaultValue={f.venue ?? ''} aria-label="Venue" className={field}>
            <option value="">All Venues</option>
            {venues.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={f.status ?? 'open'}
            aria-label="Status"
            className={`${field} capitalize`}
          >
            {['open', 'closed', 'resolved', 'all'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            name="minLiquidity"
            defaultValue={f.minLiquidity}
            inputMode="numeric"
            placeholder="Min liquidity $"
            aria-label="Minimum liquidity"
            className={`${field} w-36 placeholder:text-muted/70`}
          />
          <label
            className={`${field} flex cursor-pointer items-center gap-2 has-checked:border-accent has-checked:text-fg`}
          >
            <input
              type="checkbox"
              name="includePlayMoney"
              value="true"
              defaultChecked={f.includePlayMoney === 'true'}
              className="accent-[var(--accent)]"
            />
            Play-money
          </label>
          {/* Keep the browse selection while searching. */}
          {(['category', 'topic', 'entity'] as const).map(
            (k) => f[k] && <input key={k} type="hidden" name={k} value={f[k]} />,
          )}
        </div>
      </form>

      <nav
        aria-label="Categories"
        className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 text-sm"
      >
        <Link
          href={href({
            category: undefined,
            topic: undefined,
            entity: undefined,
            cursor: undefined,
          })}
          aria-current={f.category ? undefined : 'page'}
          className={tab(!f.category)}
        >
          All
        </Link>
        {cats.items.map((c) => (
          <Link
            key={c.id}
            href={href({ category: c.id, topic: undefined, entity: undefined })}
            aria-current={f.category === c.id ? 'page' : undefined}
            className={tab(f.category === c.id)}
          >
            {c.label}
            <span className="rounded-full bg-surface-2/80 px-1.5 font-mono text-[0.65rem] text-muted">
              {c.eventCount}
            </span>
          </Link>
        ))}
      </nav>
      {activeCat && activeCat.topics.length > 0 && (
        <nav aria-label="Topics" className="mb-2 flex flex-wrap gap-2 text-xs text-muted">
          {activeCat.topics.map((t) => (
            <Link
              key={t.id}
              href={href({ topic: t.id, entity: undefined })}
              className={f.topic === t.id ? 'font-medium text-fg' : 'hover:underline'}
            >
              {t.label} ({t.eventCount})
            </Link>
          ))}
        </nav>
      )}

      <section aria-label="Results" className="mt-8">
        {list.items.length === 0 ? (
          <EmptyState>No Events match.</EmptyState>
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.items.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
        {list.nextCursor && (
          <Link
            href={href({ cursor: list.nextCursor })}
            className="mt-8 inline-block rounded-sm border border-border px-4 py-2 text-sm hover:border-fg"
          >
            Next page
          </Link>
        )}
      </section>

      <section aria-labelledby="venues-h" className="mt-10">
        <h2 id="venues-h" className="mb-3 text-sm font-medium text-muted">
          Venues
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {venues.items.map((v) => (
            <li key={v.id} className="flex items-center gap-2">
              {v.name} <VenueLabel label={v.label} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
