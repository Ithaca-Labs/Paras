import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createPolymarketAdapter, createPolymarketQuoteStream } from '../src/index.js';
import { stubFetch } from './helpers.js';

// Live capture 2026-10-14 ("Trump out as President before 2027?"): the CLOB put the same
// market-level last_trade_price (0.959, the NO side's price) on both token books (#131).
const load = (f: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/polymarket-live/${f}`, import.meta.url), 'utf8'));
const books = load('clob-books-trump-out-2027.json');
const frames = load('market-channel-book-frames.json');
const [yes, no] = books.map((b: { asset_id: string }) => b.asset_id);

describe('polymarket last trade price (#131)', () => {
  it('poll: drops a last outside the Outcome own spread, keeps it inside', async () => {
    const adapter = createPolymarketAdapter({ fetch: stubFetch({ '/books': books }) });
    const q = await adapter.fetchQuotes([yes, no]);
    const last = (id: string) => q.find((x) => x.outcomeExternalId === id)!.last;
    expect(last(yes)).toBeNull(); // 0.959 vs bid/ask 0.039/0.041
    expect(last(no)).toBe('0.959'); // 0.959 vs bid/ask 0.959/0.961
  });

  it('stream: same attribution on book snapshots', () => {
    vi.useFakeTimers();
    let push: (m: unknown) => void = () => {};
    const out: { outcomeExternalId: string; last: string | null }[] = [];
    const stream = createPolymarketQuoteStream({
      onQuotes: (qs) => void out.push(...qs),
      createSocket: () => {
        const s = {
          send() {},
          close() {},
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null as ((e: { data: unknown }) => void) | null,
        };
        push = (m) => s.onmessage?.({ data: JSON.stringify(m) });
        return s;
      },
      flushMs: 1000,
    });
    stream.setAssets([yes, no]);
    push(frames);
    vi.advanceTimersByTime(1000);
    stream.stop();
    vi.useRealTimers();
    expect(out.find((q) => q.outcomeExternalId === yes)!.last).toBeNull();
    expect(out.find((q) => q.outcomeExternalId === no)!.last).toBe('0.959');
  });
});
