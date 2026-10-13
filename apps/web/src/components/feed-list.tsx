'use client';

import type { Feed, FeedItem } from '@paras/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { EventCard } from './event-card';

const chip = 'rounded-full border px-2.5 py-0.5 text-xs';
const act =
  'rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-fg disabled:opacity-50';

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
        <span className={`${chip} ${smart ? 'border-accent text-fg' : 'border-border text-muted'}`}>
          {item.reason}
        </span>
      </div>
      <EventCard event={item.event} />
      <div className="flex gap-2">
        <button className={act} disabled={busy} onClick={toggleFollow} aria-pressed={following}>
          {following ? 'Following' : 'Follow'}
        </button>
        <button className={act} disabled={busy} onClick={() => signal('fewer_like_this')}>
          Fewer like this
        </button>
        <button className={act} disabled={busy} onClick={() => signal('dismiss')}>
          Dismiss
        </button>
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
