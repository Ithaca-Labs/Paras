import type { Quote } from '@paras/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolymarketQuoteStream, type SocketLike } from '../src/index.js';

// Hand-written frames following the CLOB market-channel docs (HTTP-only fixture harness).
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send = (d: string) => void this.sent.push(d);
  close = () => this.onclose?.({});
  open = () => this.onopen?.({});
  push = (m: unknown) => this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) });
}

const book = {
  event_type: 'book',
  asset_id: 'yes',
  timestamp: '1760000000000',
  bids: [
    { price: '0.40', size: '100' },
    { price: '0.39', size: '50' },
  ],
  asks: [{ price: '0.45', size: '80' }],
  last_trade_price: '0.42',
};

let out: Quote[][];
const make = () =>
  createPolymarketQuoteStream({
    onQuotes: (q) => void out.push(q),
    createSocket: () => new FakeSocket(),
    flushMs: 1000,
    backoffMs: { min: 1000, max: 4000 },
  });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  out = [];
});
afterEach(() => vi.useRealTimers());

describe('polymarket quote stream', () => {
  it('subscribes, applies snapshot + deltas, and flushes throttled Quotes', () => {
    const stream = make();
    stream.setAssets(['yes', 'no']);
    const ws = FakeSocket.all[0]!;
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'market', assets_ids: ['yes', 'no'] });
    expect(stream.covers('yes')).toBe(false); // no snapshot yet

    ws.push([book, { ...book, asset_id: 'other' }]); // unsubscribed asset ignored
    expect(stream.covers('yes')).toBe(true);
    expect(stream.covers('no')).toBe(false);

    // Burst of deltas inside one throttle window -> one emission.
    ws.push({
      event_type: 'price_change',
      timestamp: '1760000000500',
      price_changes: [
        { asset_id: 'yes', price: '0.41', size: '30', side: 'BUY' },
        { asset_id: 'yes', price: '0.45', size: '0', side: 'SELL' },
        { asset_id: 'yes', price: '0.46', size: '20', side: 'SELL' },
      ],
    });
    ws.push({ event_type: 'last_trade_price', asset_id: 'yes', price: '0.43' });
    ws.push('PONG');
    expect(out).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1);
    expect(out[0]![0]).toMatchObject({
      outcomeExternalId: 'yes',
      bid: '0.41',
      ask: '0.46',
      last: '0.43',
    });
    vi.advanceTimersByTime(5000);
    expect(out).toHaveLength(1); // nothing changed
    stream.stop();
  });

  it('diffs subscriptions on an open socket', () => {
    const stream = make();
    stream.setAssets(['a', 'b']);
    const ws = FakeSocket.all[0]!;
    ws.open();
    stream.setAssets(['b', 'c']);
    expect(ws.sent.slice(1).map((s) => JSON.parse(s))).toEqual([
      { operation: 'subscribe', assets_ids: ['c'] },
      { operation: 'unsubscribe', assets_ids: ['a'] },
    ]);
    stream.stop();
  });

  it('drops coverage when the socket dies, reconnects with backoff and resubscribes', () => {
    const stream = make();
    stream.setAssets(['yes']);
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.push(book);
    expect(stream.covers('yes')).toBe(true);

    FakeSocket.all[0]!.close();
    expect(stream.covers('yes')).toBe(false); // poll job takes over
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);

    FakeSocket.all[1]!.close(); // fails again: delay doubles
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    FakeSocket.all[2]!.open();
    expect(JSON.parse(FakeSocket.all[2]!.sent[0]!)).toEqual({
      type: 'market',
      assets_ids: ['yes'],
    });
    FakeSocket.all[2]!.push(book);
    expect(stream.covers('yes')).toBe(true);
    stream.stop();
  });
});
