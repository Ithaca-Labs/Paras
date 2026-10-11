import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { EventCard } from '@/components/event-card';
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
  const field = 'rounded-lg border border-border bg-surface px-3 py-1.5 text-sm';
  const activeCat = cats.items.find((c) => c.id === f.category);

  return (
    <>
      <PageHeader title="Explore">Search and compare prices across Venues.</PageHeader>

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <input
          name="q"
          defaultValue={f.q}
          placeholder="Search Events, e.g. Fed rate cut"
          aria-label="Search"
          className={`${field} min-w-64 flex-1`}
        />
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
        <button className="rounded-lg bg-accent px-4 py-1.5 text-sm text-accent-fg">Search</button>
      </form>

      <nav aria-label="Categories" className="mb-2 flex flex-wrap gap-2 text-sm">
        <Link
          href={href({
            category: undefined,
            topic: undefined,
            entity: undefined,
            cursor: undefined,
          })}
          className={`rounded-full border border-border px-3 py-1 ${f.category ? '' : 'bg-accent text-accent-fg'}`}
        >
          All
        </Link>
        {cats.items.map((c) => (
          <Link
            key={c.id}
            href={href({ category: c.id, topic: undefined, entity: undefined })}
            className={`rounded-full border border-border px-3 py-1 ${f.category === c.id ? 'bg-accent text-accent-fg' : ''}`}
          >
            {c.label} <span className="text-muted">{c.eventCount}</span>
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

      <section aria-label="Results" className="mt-6">
        {list.items.length === 0 ? (
          <EmptyState>No Events match.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.items.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
        {list.nextCursor && (
          <Link
            href={href({ cursor: list.nextCursor })}
            className="mt-6 inline-block rounded-lg border border-border px-4 py-1.5 text-sm"
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
