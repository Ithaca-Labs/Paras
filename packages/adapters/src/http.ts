export interface HttpOptions {
  /** Short Venue name for error messages. */
  name: string;
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Minimum gap between requests, to respect the Venue's rate limit. */
  minIntervalMs?: number;
  headers?: Record<string, string>;
}

export interface Http {
  /** Parsed JSON, or null on 404; throws on any other non-2xx. `url` is absolute. */
  getJson(url: string): Promise<unknown>;
  /** Concurrent map in small batches (requests still spaced by `minIntervalMs`), keeping order. */
  mapBatched<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, size?: number): Promise<R[]>;
}

/** Shared by the long-tail adapters: spaced requests, 404 -> null, errors carry the Venue name. */
export function createHttp(options: HttpOptions): Http {
  const doFetch = options.fetch ?? fetch;
  // An injected fetch is a fixture replay or stub, never the network: nothing to space out.
  const gap = options.fetch ? 0 : (options.minIntervalMs ?? 0);
  let nextSlot = 0;

  async function throttle(): Promise<void> {
    const t = Date.now();
    const slot = Math.max(nextSlot, t);
    nextSlot = slot + gap;
    if (slot > t) await new Promise((r) => setTimeout(r, slot - t));
  }

  return {
    async getJson(url) {
      await throttle();
      const res = await doFetch(url, options.headers ? { headers: options.headers } : undefined);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${options.name} ${res.status} GET ${url}`);
      return res.json();
    },
    async mapBatched(items, fn, size = 5) {
      const out: Awaited<ReturnType<typeof fn>>[] = [];
      for (let i = 0; i < items.length; i += size) {
        out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
      }
      return out;
    },
  };
}

/** Complement of a 0..1 price, rounded to 6 places. */
export const complement = (price: number): number => Math.round((1 - price) * 1e6) / 1e6;
export const validPrice = (p: number): boolean => Number.isFinite(p) && p > 0 && p < 1;
export const msToIso = (ms: number | null | undefined): string | null => {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const strToIso = (s: string | null | undefined): string | null =>
  s ? msToIso(new Date(s).getTime() || null) : null;
