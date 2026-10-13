'use client';

import type { Feed, FeedItem } from '@paras/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { EventCard } from './event-card';

const chip = 'inline-flex items-center gap-1.5 text-xs';
const act =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50';
const quiet = `${act} border-transparent text-muted hover:border-border hover:bg-surface hover:text-fg`;
const icon = (d: string) => (
  <svg
    aria-hidden
    viewBox="0 0 16 16"
    className="size-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

/** Feed card with reason chip + dismiss / fewer-like-this / follow. Ranking is the API's; we only send signals. */
function FeedCard({
  item,
  followed,
  onGone,
}: {
  item: FeedItem;
  followed: boolean;
  onGone: (id: string) => void;
}) {
  const [following, setFollowing] = useState(followed);
  const [busy, setBusy] = useState(false);
  const id = item.event.id;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* leave UI unchanged on failure */
    } finally {
      setBusy(false);
    }
  };
  const signal = (kind: 'dismiss' | 'fewer_like_this') =>
    run(async () => {
      await api.recordFeedSignal({ body: { eventId: id, kind } });
      onGone(id);
    });
  const toggleFollow = () =>
    run(async () => {
      const body = { kind: 'event' as const, targetId: id };
      if (following) await api.removeFollow({ query: body });
      else await api.addFollow({ body });
      setFollowing(!following);
    });
  const smart = item.reason.toLowerCase().includes('smart money');
  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className={`${chip} ${smart ? 'font-medium text-accent' : 'text-muted'}`}>
          <span
            aria-hidden
            className={`size-1.5 rounded-[1px] ${smart ? 'bg-accent' : 'bg-gold'}`}
          />
          {item.reason}
        </span>
      </div>
      <EventCard event={item.event} />
      <div className="flex items-center gap-1 px-1">
        <button
          className={`${act} ${
            following
              ? 'border-accent bg-accent text-accent-fg hover:brightness-110'
              : 'border-accent/50 text-accent hover:border-accent hover:bg-accent/10'
          }`}
          disabled={busy}
          onClick={toggleFollow}
          aria-pressed={following}
        >
          {icon(following ? 'M3.5 8.5l3 3 6-7' : 'M8 3.5v9M3.5 8h9')}
          {following ? 'Following' : 'Follow'}
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          <button className={quiet} disabled={busy} onClick={() => signal('fewer_like_this')}>
            {icon('M4 8h8')}
            Fewer like this
          </button>
          <button
            className={`${quiet} hover:!text-negative`}
            disabled={busy}
            onClick={() => signal('dismiss')}
          >
            {icon('M4.5 4.5l7 7M11.5 4.5l-7 7')}
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}

export function FeedList({
  feed,
  followedEventIds,
}: {
  feed: Pick<Feed, 'items' | 'beginners'>;
  followedEventIds: string[];
}) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const hide = (id: string) => setGone((s) => new Set(s).add(id));
  const list = (items: FeedItem[]) =>
    items
      .filter((i) => !gone.has(i.event.id))
      .map((i) => (
        <FeedCard
          key={i.event.id}
          item={i}
          followed={followedEventIds.includes(i.event.id)}
          onGone={hide}
        />
      ));
  const grid = 'stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3';
  return (
    <div className="flex flex-col gap-10">
      {feed.beginners.length > 0 && (
        <section aria-labelledby="beginners">
          <h2 id="beginners" className="mb-3 text-lg font-medium">
            New to prediction markets?
          </h2>
          <div className={grid}>{list(feed.beginners)}</div>
        </section>
      )}
      <section aria-label="For you">
        {/* Beginners are shown on top; don't repeat them here. */}
        <div className={grid}>
          {list(feed.items.filter((i) => !feed.beginners.some((b) => b.event.id === i.event.id)))}
        </div>
      </section>
    </div>
  );
}
