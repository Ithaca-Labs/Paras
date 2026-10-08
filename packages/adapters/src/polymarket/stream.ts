import type { Quote } from '@paras/shared';
import { z } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import { orderBookToQuote } from './normalize.js';

/** Subset of the WHATWG WebSocket the stream needs (Node 22's global satisfies it). */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface QuoteStreamOptions {
  /** Receives changed Quotes, at most once per `flushMs`. */
  onQuotes(quotes: Quote[]): void | Promise<void>;
  onError?(err: unknown): void;
  /** Injectable for tests. Defaults to the global WebSocket. */
  createSocket?: (url: string) => SocketLike;
  url?: string;
  /** Throttle between Quote emissions. */
  flushMs?: number;
  /** Reconnect delay doubles from min to max. */
  backoffMs?: { min: number; max: number };
  pingMs?: number;
  now?: () => Date;
}

export interface QuoteStream {
  /** Subscribe to exactly these Outcomes (token ids); opens the socket on first call. */
  setAssets(ids: readonly string[]): void;
  /** True while the socket is open and `id` has its book snapshot. Callers poll everything else. */
  covers(id: string): boolean;
  stop(): void;
}

const Level = z.object({ price: z.string(), size: z.string() });
const Book = z.object({
  event_type: z.literal('book'),
  asset_id: z.string(),
  timestamp: z.string().nullish(),
  bids: z.array(Level),
  asks: z.array(Level),
  last_trade_price: z.string().nullish(),
});
const PriceChange = z.object({
  event_type: z.literal('price_change'),
  timestamp: z.string().nullish(),
  price_changes: z.array(
    z.object({ asset_id: z.string(), price: z.string(), size: z.string(), side: z.string() }),
  ),
});
const LastTrade = z.object({
  event_type: z.literal('last_trade_price'),
  asset_id: z.string(),
  price: z.string(),
  timestamp: z.string().nullish(),
});
const Message = z.union([Book, PriceChange, LastTrade]);

interface BookState {
  bids: Map<string, string>;
  asks: Map<string, string>;
  last: string | null;
  at: Date;
}

/**
 * Polymarket CLOB public market channel: book snapshots seed per-Outcome state, price_change
 * deltas patch it (size 0 removes a level), and changed books are flushed as Quotes on a timer.
 * Reconnects with exponential backoff and resubscribes; while down, `covers` is false so the
 * poll job takes over.
 */
export function createPolymarketQuoteStream(opts: QuoteStreamOptions): QuoteStream {
  const url = opts.url ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  const open = opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
  const flushMs = opts.flushMs ?? 1000;
  const { min, max } = opts.backoffMs ?? { min: 1000, max: 30_000 };
  const now = opts.now ?? (() => new Date());

  let wanted = new Set<string>();
  const books = new Map<string, BookState>();
  const dirty = new Set<string>();
  let socket: SocketLike | null = null;
  let connected = false;
  let stopped = false;
  let delay = min;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const flush = () => {
    if (!dirty.size) return;
    const quotes = [...dirty].flatMap((id) => {
      const b = books.get(id);
      if (!b) return [];
      const levels = (m: Map<string, string>) => [...m].map(([price, size]) => ({ price, size }));
      return [
        orderBookToQuote({
          outcomeExternalId: id,
          bids: levels(b.bids),
          asks: levels(b.asks),
          lastTradePrice: b.last,
          observedAt: b.at.toISOString(),
        }),
      ];
    });
    dirty.clear();
    Promise.resolve(opts.onQuotes(quotes)).catch((e) => opts.onError?.(e));
  };

  const at = (ts: string | null | undefined) => {
    const ms = Number(ts);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms) : now();
  };

  function apply(msg: z.infer<typeof Message>) {
    if (msg.event_type === 'book') {
      if (!wanted.has(msg.asset_id)) return;
      const level = (ls: { price: string; size: string }[]) =>
        new Map(
          ls
            .filter((l) => Number(l.size) > 0)
            .map((l) => [toDecimalString(l.price), toDecimalString(l.size)]),
        );
      books.set(msg.asset_id, {
        bids: level(msg.bids),
        asks: level(msg.asks),
        last: msg.last_trade_price ? toDecimalString(msg.last_trade_price) : null,
        at: at(msg.timestamp),
      });
      dirty.add(msg.asset_id);
    } else if (msg.event_type === 'price_change') {
      for (const c of msg.price_changes) {
        const b = books.get(c.asset_id);
        if (!b) continue; // delta before snapshot: wait for the book
        const side = c.side.toUpperCase() === 'BUY' ? b.bids : b.asks;
        const price = toDecimalString(c.price);
        if (Number(c.size) > 0) side.set(price, toDecimalString(c.size));
        else side.delete(price);
        b.at = at(msg.timestamp);
        dirty.add(c.asset_id);
      }
    } else {
      const b = books.get(msg.asset_id);
      if (!b) return;
      b.last = toDecimalString(msg.price);
      b.at = at(msg.timestamp);
      dirty.add(msg.asset_id);
    }
  }

  function connect() {
    if (stopped || socket) return;
    const s = open(url);
    socket = s;
    s.onopen = () => {
      connected = true;
      delay = min;
      s.send(JSON.stringify({ type: 'market', assets_ids: [...wanted] }));
      ping = setInterval(() => s.send('PING'), opts.pingMs ?? 10_000);
    };
    s.onmessage = ({ data }) => {
      let json: unknown;
      try {
        json = JSON.parse(String(data));
      } catch {
        return; // PONG and other non-JSON frames
      }
      for (const raw of Array.isArray(json) ? json : [json]) {
        const m = Message.safeParse(raw);
        if (m.success) apply(m.data);
      }
    };
    const down = () => {
      if (socket !== s) return;
      socket = null;
      connected = false;
      books.clear(); // stale after a gap; the next subscribe re-sends full books
      clearInterval(ping);
      if (stopped) return;
      reconnect = setTimeout(connect, delay);
      delay = Math.min(delay * 2, max);
    };
    s.onclose = down;
    s.onerror = (e) => {
      opts.onError?.(e);
      down();
      s.close();
    };
  }

  const flusher = setInterval(flush, flushMs);

  return {
    setAssets(ids) {
      const next = new Set(ids);
      const prev = wanted;
      wanted = next;
      for (const id of prev) if (!next.has(id)) books.delete(id);
      if (!socket) return connect();
      if (!connected) return;
      const added = ids.filter((id) => !prev.has(id));
      const removed = [...prev].filter((id) => !next.has(id));
      if (added.length) socket.send(JSON.stringify({ operation: 'subscribe', assets_ids: added }));
      if (removed.length)
        socket.send(JSON.stringify({ operation: 'unsubscribe', assets_ids: removed }));
    },
    covers: (id) => connected && books.has(id),
    stop() {
      stopped = true;
      connected = false;
      clearTimeout(reconnect);
      clearInterval(ping);
      clearInterval(flusher);
      socket?.close();
      socket = null;
    },
  };
}
