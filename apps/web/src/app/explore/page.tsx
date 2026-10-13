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
    'rounded-sm border-0 border-b border-border bg-transparent px-1 py-1.5 text-sm hover:border-fg focus:border-accent focus:outline-none';
  const tab = (on: boolean) =>
    `relative flex items-center gap-1.5 rounded-sm px-2.5 py-1 ${
      on
        ? 'font-medium text-fg before:size-2 before:rounded-[2px] before:bg-seal'
        : 'text-muted hover:bg-surface-2 hover:text-fg'
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
          <div className="grid gap-8 px-5 py-7 md:grid-cols-[1.1fr_1fr] md:px-8 md:py-9">
            <div className="fade-up" style={{ animationDelay: '500ms' }}>
              <h1 className="text-4xl leading-[1.1] font-extrabold text-balance md:text-5xl">
                One question.
                <br />
                Every Venue&rsquo;s price.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
                Paras reads {venues.items.length} prediction market Venues side by side, so you can
                see where the odds disagree before you bet.
              </p>
            </div>
            <div className="fade-up self-end" style={{ animationDelay: '700ms' }}>
              <p className="text-xs text-muted">
                {spread(featured) > 0 ? 'Widest disagreement right now' : 'Most traded right now'}
              </p>
              <Link
                href={`/events/${featured.id}`}
                className="mt-1 block font-display text-xl leading-snug font-bold decoration-gold decoration-2 underline-offset-4 hover:underline"
              >
                {featured.title}
              </Link>
              <OddsLine event={featured} size="lg" />
            </div>
          </div>
        </Handscroll>
      ) : (
        <PageHeader title="Explore">Search and compare prices across Venues.</PageHeader>
      )}

      <form
        method="get"
        role="search"
        className="mb-6 flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-border pb-4"
      >
        <label className="flex min-w-64 flex-1 items-center gap-2 border-b border-fg/40 focus-within:border-accent">
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 text-muted">
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
            className="w-full bg-transparent py-2 font-display text-lg placeholder:text-muted/70 focus:outline-none"
          />
        </label>
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
          className={field}
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
          className={`${field} w-36`}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="includePlayMoney"
            value="true"
            defaultChecked={f.includePlayMoney === 'true'}
          />
          Play-money
        </label>
        {/* Keep the browse selection while searching. */}
        {(['category', 'topic', 'entity'] as const).map(
          (k) => f[k] && <input key={k} type="hidden" name={k} value={f[k]} />,
        )}
        <button className="rounded-sm bg-accent px-5 py-2 text-sm font-medium text-accent-fg hover:brightness-110">
          Search
        </button>
      </form>

      <nav aria-label="Categories" className="mb-3 flex flex-wrap gap-x-1 gap-y-2 text-sm">
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
            {c.label} <span className="font-mono text-[0.65rem] text-muted">{c.eventCount}</span>
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
