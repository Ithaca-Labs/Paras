import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { recordQuotes, upsertMarkets, upsertVenue } from '@paras/db';
import { ApiError, QuoteStreamMessage } from '@paras/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let venue: FakeAdapter;
let clock = new Date('2026-10-09T12:00:00Z');

/** Sync Markets then poll Quotes the way the worker does, against the in-memory Venue. */
async function ingest() {
  const { items } = await venue.listMarkets({ status: 'all' });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, items);
  const ids = items.flatMap((m) => m.outcomes.map((o) => o.externalId));
  await recordQuotes(t.db, venue.id, await venue.fetchQuotes(ids), { now: clock });
}

beforeAll(async () => {
  venue = createFakeAdapter({
    id: 'fake-venue',
    name: 'Fake Venue',
    capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: ['US'] },
    now: () => clock,
    markets: [
      fakeMarket('big', { volume: '9000', url: 'https://fake.example/event/big' }),
      fakeMarket('mid', { volume: '5000' }),
      fakeMarket('small', { volume: '100' }),
      fakeMarket('done', { volume: '50000', status: 'resolved' }),
    ],
  });
  venue.setBook('big-yes', {
    bids: [
      { price: '0.40', size: '100' },
      { price: '0.38', size: '200' },
    ],
    asks: [{ price: '0.45', size: '50' }],
    lastTradePrice: '0.42',
  });
  venue.setBook('big-no', {
    bids: [{ price: '0.55', size: '50' }],
    asks: [{ price: '0.60', size: '100' }],
  });
  t = await createTestApp({ adapters: [venue], now: () => clock, ssePollMs: 25 });
  await ingest();
});
afterAll(() => t.close());

describe('GET /v1/events', () => {
  it('lists open Events by volume with prices, depth and freshness', async () => {
    const { items, nextCursor } = await t.client.listEvents({ query: {} });
    expect(nextCursor).toBeNull();
    expect(items.map((e) => e.title)).toEqual([
      'Will big happen?',
      'Will mid happen?',
      'Will small happen?',
    ]);

    const [big] = items;
    expect(big).toMatchObject({
      status: 'open',
      volume: '9000',
      quotesUpdatedAt: '2026-10-09T12:00:00.000Z',
    });
    expect(big!.markets).toHaveLength(1);
    const m = big!.markets[0]!;
    expect(m).toMatchObject({
      venue: { id: 'fake-venue', name: 'Fake Venue', capabilities: { routable: true } },
      url: 'https://fake.example/event/big',
      redirectUrl: 'https://fake.example/event/big',
      rules: 'Resolves YES if it happens.',
      matchConfidence: '1',
      stale: false,
      quotesUpdatedAt: '2026-10-09T12:00:00.000Z',
    });
    expect(m.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(m.outcomes[0]!.quote).toEqual({
      bid: '0.4',
      ask: '0.45',
      last: '0.42',
      bidDepth: '116', // 0.40*100 + 0.38*200
      askDepth: '22.5',
      observedAt: '2026-10-09T12:00:00.000Z',
    });
  });

  it('shows Markets without Quotes as stale with null prices', async () => {
    const { items } = await t.client.listEvents({ query: {} });
    const mid = items.find((e) => e.title === 'Will mid happen?')!;
    expect(mid.quotesUpdatedAt).toBeNull();
    expect(mid.markets[0]!.stale).toBe(true);
    expect(mid.markets[0]!.outcomes.every((o) => o.quote === null)).toBe(true);
  });

  it('paginates with a cursor', async () => {
    const first = await t.client.listEvents({ query: { limit: 2 } });
    expect(first.items.map((e) => e.title)).toEqual(['Will big happen?', 'Will mid happen?']);
    expect(first.nextCursor).toBe('2');
    const second = await t.client.listEvents({ query: { limit: 2, cursor: first.nextCursor! } });
    expect(second.items.map((e) => e.title)).toEqual(['Will small happen?']);
    expect(second.nextCursor).toBeNull();
  });

  it('filters by status and Venue', async () => {
    const resolved = await t.client.listEvents({ query: { status: 'resolved' } });
    expect(resolved.items.map((e) => e.title)).toEqual(['Will done happen?']);
    const all = await t.client.listEvents({ query: { status: 'all' } });
    expect(all.items).toHaveLength(4);
    const none = await t.client.listEvents({ query: { venue: 'kalshi' } });
    expect(none.items).toEqual([]);
    const fake = await t.client.listEvents({ query: { venue: 'fake-venue' } });
    expect(fake.items).toHaveLength(3);
  });

  it('rejects bad query and cursor with 400', async () => {
    await expect(t.client.listEvents({ query: { limit: 0 } })).rejects.toMatchObject({
      status: 400,
    });
    await expect(t.client.listEvents({ query: { cursor: 'abc' } })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('GET /v1/events/{id}', () => {
  it('returns one Event and flags Quotes older than the staleness window', async () => {
    const [big] = (await t.client.listEvents({ query: {} })).items;
    const fresh = await t.client.getEvent({ params: { id: big!.id } });
    expect(fresh).toEqual(big);
    expect(fresh.markets[0]!.stale).toBe(false);

    const prev = clock;
    clock = new Date(prev.getTime() + 5 * 60_000);
    const later = await t.client.getEvent({ params: { id: big!.id } });
    clock = prev;
    expect(later.markets[0]!.stale).toBe(true);
    expect(later.quotesUpdatedAt).toBe(fresh.quotesUpdatedAt);
  });

  it('404s for an unknown Event with the shared error shape', async () => {
    const err = await t.client
      .getEvent({ params: { id: '00000000-0000-4000-8000-000000000000' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body?.error.code).toBe('not_found');
  });

  it('400s for a malformed id', async () => {
    await expect(t.client.getEvent({ params: { id: 'nope' } })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('GET /v1/events/{id}/stream (SSE)', () => {
  /** Reads `event: quote` messages from an open stream. */
  async function openStream(url: string, signal: AbortSignal) {
    const res = await fetch(url, { signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    return async (): Promise<QuoteStreamMessage> => {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(frame);
          if (/^event: quote$/m.test(frame) && data) {
            return QuoteStreamMessage.parse(JSON.parse(data[1]!));
          }
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('stream ended');
        buffer += chunk.value;
      }
    };
  }

  it('emits current Quotes on connect, then a message when a Quote updates', async () => {
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const [big] = (await t.client.listEvents({ query: {} })).items;
    const ctrl = new AbortController();
    try {
      const next = await openStream(`${address}/v1/events/${big!.id}/stream`, ctrl.signal);

      const first = [await next(), await next()];
      expect(first.map((m) => m.quote.bid).sort()).toEqual(['0.4', '0.55']);
      expect(first[0]).toMatchObject({ eventId: big!.id, venueId: 'fake-venue' });

      clock = new Date('2026-10-09T12:00:30Z');
      venue.setBook('big-yes', {
        bids: [{ price: '0.41', size: '100' }],
        asks: [{ price: '0.44', size: '50' }],
      });
      await recordQuotes(t.db, venue.id, await venue.fetchQuotes(['big-yes']), { now: clock });

      const update = await next();
      expect(update.quote).toMatchObject({
        bid: '0.41',
        ask: '0.44',
        observedAt: '2026-10-09T12:00:30.000Z',
      });
      expect(update.outcomeId).toBe(big!.markets[0]!.outcomes[0]!.id);
    } finally {
      ctrl.abort();
    }
  });

  it('404s before opening the stream for an unknown Event', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/events/00000000-0000-4000-8000-000000000000/stream',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('OpenAPI', () => {
  it('documents Event routes and the SSE stream', async () => {
    const doc = (await t.app.inject({ method: 'GET', url: '/v1/openapi.json' })).json();
    expect(doc.paths['/v1/events'].get.operationId).toBe('listEvents');
    expect(doc.paths['/v1/events/{id}'].get.operationId).toBe('getEvent');
    const stream = doc.paths['/v1/events/{id}/stream'].get;
    expect(stream.operationId).toBe('streamEventQuotes');
    expect(stream.responses['200'].content['text/event-stream']).toBeDefined();
  });
});
