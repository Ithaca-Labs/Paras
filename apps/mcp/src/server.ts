import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ApiClient, type EventView } from '@paras/shared';

/**
 * Read-only MCP server: each tool is a thin wrapper over the typed API client (@paras/shared).
 * Never add a tool that moves money or places trades. No business logic here.
 */
export function createMcpServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'paras', version: '0.0.0' });

  const source = z
    .enum(['claude', 'codex'])
    .default('claude')
    .describe('Which assistant is calling; recorded on the Magic Link');
  const out = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  });

  // Every Event result carries a Magic Link (opens the Event on Paras; nothing is signed or placed).
  const withLinks = (events: EventView[], src: 'claude' | 'codex') =>
    Promise.all(
      events.map(async (e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        status: e.status,
        endDate: e.endDate,
        volume: e.volume,
        move24h: e.move24h,
        quotesUpdatedAt: e.quotesUpdatedAt,
        magicLink: await api
          .createMagicLink({ body: { eventId: e.id, source: src, bindToUser: false } })
          .then((l) => l.url)
          .catch(() => null),
        markets: e.markets.map((m) => ({
          venue: m.venue.id,
          availability: m.availability,
          question: m.question,
          stale: m.stale,
          redirectUrl: m.redirectUrl,
          outcomes: m.outcomes.map((o) => ({
            label: o.label,
            bid: o.quote?.bid ?? null,
            ask: o.quote?.ask ?? null,
            last: o.quote?.last ?? null,
          })),
        })),
      })),
    );

  const filters = {
    status: z.enum(['open', 'closed', 'resolved', 'all']).optional(),
    venue: z.string().optional().describe('Venue id, e.g. polymarket, kalshi'),
    category: z.string().optional(),
    topic: z.string().optional(),
    entity: z.string().optional(),
    closesAfter: z.iso.datetime().optional(),
    closesBefore: z.iso.datetime().optional(),
    minLiquidity: z.number().min(0).optional(),
    limit: z.number().int().min(1).max(20).default(10),
    cursor: z.string().optional(),
    source,
  };
  type Filters = z.infer<z.ZodObject<typeof filters>>;

  const list = async (args: Filters & { q?: string }, sort?: 'trending' | 'closing_soon') => {
    const { source: src, ...query } = args;
    const page = await api.listEvents({
      query: { ...query, ...(sort && { sort }) } as Parameters<ApiClient['listEvents']>[0]['query'],
    });
    return out({ items: await withLinks(page.items, src), nextCursor: page.nextCursor });
  };

  server.registerTool(
    'search_events',
    {
      description:
        'Search prediction-market Events across Venues (words + meaning). Returns prices, per-Venue availability for the caller and a Magic Link to open each Event on Paras.',
      inputSchema: { q: z.string().min(1).max(300).optional(), ...filters },
    },
    (args) => list(args),
  );

  server.registerTool(
    'list_trending',
    { description: 'Trending open Events, with Magic Links.', inputSchema: filters },
    (args) => list(args, 'trending'),
  );

  server.registerTool(
    'list_closing_soon',
    { description: 'Open Events resolving soonest, with Magic Links.', inputSchema: filters },
    (args) => list(args, 'closing_soon'),
  );

  server.registerTool(
    'get_event',
    {
      description:
        'One Event with every Venue Market, Outcome prices, availability and a Magic Link.',
      inputSchema: { eventId: z.string().uuid(), source },
    },
    async ({ eventId, source: src }) => {
      const event = await api.getEvent({ params: { id: eventId } });
      return out((await withLinks([event], src))[0]);
    },
  );

  server.registerTool(
    'compare_prices',
    {
      description:
        'Fee-adjusted cross-Venue price comparison per Outcome; pass stake (USD) for size-aware fills.',
      inputSchema: { eventId: z.string().uuid(), stake: z.string().optional() },
    },
    async ({ eventId, stake }) =>
      out(
        await api.compareEvent({
          params: { id: eventId },
          query: { divergenceThreshold: '0.05', ...(stake && { stake }) },
        }),
      ),
  );

  server.registerTool(
    'create_magic_link',
    {
      description:
        'Mint a short-lived link to an Event on Paras, optionally prefilled with Outcome/amount/maxPrice. The user opens it and signs themselves; nothing is placed here.',
      inputSchema: {
        eventId: z.string().uuid(),
        outcome: z.string().optional(),
        amount: z.string().optional().describe('USDC stake'),
        maxPrice: z.string().optional().describe('Worst acceptable price per share, (0,1]'),
        source,
      },
    },
    async (args) => out(await api.createMagicLink({ body: { ...args, bindToUser: false } })),
  );

  return server;
}
