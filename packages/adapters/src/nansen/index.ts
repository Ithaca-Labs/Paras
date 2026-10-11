import { z } from '@paras/shared';

const Holder = z.object({
  side: z.string(),
  position_size: z.number(),
  current_price: z.number(),
  unrealized_pnl_usd: z.number(),
});
const Trade = z.object({
  timestamp: z.string(),
  taker_action: z.string(),
  side: z.string(),
  usdc_value: z.number(),
});
const Netflow = z.object({ token_symbol: z.string(), net_flow_24h_usd: z.number() });
const page = <T extends z.ZodType>(row: T) => z.object({ data: z.array(row) });

export interface NansenResult<T> {
  data: T[];
  /** Credits this call cost (`X-Nansen-Credits-Used`); 1 when the header is absent. */
  credits: number;
}

export class NansenError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Nansen ${status} POST ${path}`);
  }
}

export interface NansenOptions {
  apiKey: string;
  /** Injectable for fixture replay (see @paras/testkit). */
  fetch?: typeof fetch;
  baseUrl?: string;
}

/**
 * Nansen API client (apikey header). Polymarket `market_id` is the condition id, i.e. our
 * Polymarket Market `externalId`. The free tier is ~10 credits/day: callers cache and cap.
 */
export function createNansenClient({
  apiKey,
  fetch: doFetch = fetch,
  baseUrl = 'https://api.nansen.ai/api/v1',
}: NansenOptions) {
  async function post<S extends z.ZodType<{ data: unknown[] }>>(
    path: string,
    body: unknown,
    schema: S,
  ): Promise<NansenResult<z.infer<S>['data'][number]>> {
    const res = await doFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new NansenError(res.status, path);
    const credits = Number(res.headers.get('x-nansen-credits-used') ?? 1);
    return {
      data: schema.parse(await res.json()).data,
      credits: Number.isFinite(credits) ? credits : 1,
    };
  }

  return {
    /** Largest holders of a Market, with unrealized PnL (profitable = "smart"). */
    topHolders: (marketId: string, perPage = 20) =>
      post(
        '/prediction-market/top-holders',
        {
          market_id: marketId,
          pagination: { page: 1, per_page: perPage },
          order_by: [{ field: 'position_size', direction: 'DESC' }],
        },
        page(Holder),
      ),
    /** Trades since `from` (ISO), newest first. */
    tradesByMarket: (marketId: string, from: string, perPage = 100) =>
      post(
        '/prediction-market/trades-by-market',
        {
          market_id: marketId,
          pagination: { page: 1, per_page: perPage },
          date: { from },
          order_by: [{ field: 'timestamp', direction: 'DESC' }],
        },
        page(Trade),
      ),
    /** Smart-money token netflow rows for a symbol (BTC, ETH, MON). */
    netflow: (symbol: string, chain = 'all') =>
      post(
        '/smart-money/netflow',
        {
          chains: [chain],
          filters: { token_address: symbol },
          pagination: { page: 1, per_page: 10 },
        },
        page(Netflow),
      ),
  };
}
export type NansenClient = ReturnType<typeof createNansenClient>;
