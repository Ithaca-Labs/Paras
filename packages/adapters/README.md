# @paras/adapters

Venue adapters: pure translators from a Venue's public API to the normalized schema in `@paras/shared` (`src/venue.ts`). No ranking, matching, caching or persistence here.

## Implementing a new Venue

Implement `VenueAdapter` (`src/types.ts`), put it in `src/<venue>/`, export a `create<Venue>Adapter({ fetch? })` factory from `src/index.ts`, and register it in the apps (`apps/api/src/index.ts`, `apps/worker/src/index.ts`).

| Member                               | Contract                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`                         | Lowercase slug (`kalshi`), display name. `id` is the Venue's primary key everywhere.                                                     |
| `capabilities`                       | `routable` (Executor can trade) vs read-only, `realMoney`, `regulation`, `restrictedJurisdictions` (ISO-2), `orderBook`, `priceHistory`. |
| `listMarkets({cursor,limit,status})` | `Page<NormalizedMarket>`, highest volume first. Cursor is opaque. Skip malformed rows; throw on transport errors. Fill `url`.            |
| `fetchQuotes(outcomeIds)`            | `Quote[]`: best bid/ask, last, USD depth per side. Batch internally. Omit unknown Outcomes.                                              |
| `fetchOrderBooks?(outcomeIds)`       | `OrderBook[]` raw levels (any order). Optional if the Venue has no books; then use `fetchQuotes` only.                                   |
| `fetchPriceHistory(id, {interval})`  | `PricePoint[]`, oldest first.                                                                                                            |
| `deepLink(market)`                   | Venue site URL for a Market.                                                                                                             |

Rules:

- **Money and prices are decimal strings** (`DecimalString`, `PriceString` 0..1), never floats. Use `toDecimalString` to coerce Venue numbers. Arithmetic lives in `@paras/domain` (`parseDecimal`, `bookToQuote`).
- **Quotes come from books.** Build a `Quote` with `bookToQuote(book)` from `@paras/domain` so best bid/ask and depth are computed identically for every Venue.
- **Identifiers.** `NormalizedMarket.externalId` is the Venue's stable market id; `NormalizedOutcome.externalId` is the id used to fetch quotes/books/history (Polymarket: condition id and CLOB token id).
- `fee` describes the Venue fee model (`none` or `curve`); extend the `FeeSchedule` union for new models. `meta` carries Venue-specific extras (tick size, neg-risk) for the Executor.
- **Injectable `fetch`.** Never call global `fetch` at module scope; take `options.fetch`.

## Testing

- Fixture replay: `createFixtureFetch({ dir: new URL('./fixtures/<venue>/', import.meta.url) })` from `@paras/testkit`. Record once with `RECORD_FIXTURES=1 pnpm --filter @paras/adapters test`, review, commit. See `test/polymarket.test.ts`.
- `createFakeAdapter` / `fakeMarket` are in-memory stand-ins with mutable order books for API and worker tests.

## Polymarket

Gamma `/markets` (metadata, volume order, offset cursor) and CLOB `POST /books` (batched, 100 tokens per call) and `/prices-history`. All free and unauthenticated. V1 polls; the CLOB WebSocket can later replace `fetchQuotes` without interface changes.

## Limitless

Free public REST (`api.limitless.exchange`): `/markets/active` (25 per page, `sortBy=high_value`, group Markets are flattened into their child Markets), `/markets/{slug}/orderbook` (YES token only; NO is derived as the mirror) and `/historical-price`. Read-only (`routable: false`), `offshore`. Market `externalId` is the slug; Outcome ids are `<slug>:yes|no`. Fees are not modeled (`none`).

## SX Bet

Free public REST (`api.sx.bet`, no key): `/markets/active` (100 per page, `paginationKey`) and V3 `/orderbook-v3/snapshot` (one call per Market). Read-only, `offshore`. Market `externalId` is the `marketHash`; Outcome ids are `<hash>:1|2`. Makers resting on an outcome are its bids; makers on the other outcome are its asks at `1 - p`. The list carries no volume or liquidity (`0`) and there is no price series (`priceHistory: false`). `url` is the league page: sx.bet has no documented per-market URL. Fees are not modeled (`none`).

## Kalshi

Public trade API v2 (`api.elections.kalshi.com`), unauthenticated, read-only: `/events?with_nested_markets` (metadata; the event carries the series ticker needed for the site URL), `/markets/{ticker}/orderbook` (one call per Market, both sides) and `/series/{s}/markets/{t}/candlesticks`. Outcome ids are `<ticker>:yes` / `<ticker>:no`; a NO bid at p is a YES ask at 1 - p. Kalshi has no volume sort, so `listMarkets` orders within each page only. Volume is contracts (US$1 notional), as the Kalshi site shows it. `NormalizedMarket.url` (exposed as `redirectUrl` by the Event API) is `kalshi.com/markets/<series>/<slug>/<event>`; the slug is cosmetic. `routable: false`: never place orders here.

## PolyRouter (long tail)

`createPolyRouterAdapters({ apiKey })` returns one `VenueAdapter` per long-tail Venue (Myriad, Opinion, Predict.fun, ProphetX, Novig, Polymarket US; Manifold only with `includePlayMoney`). Natively covered Venues are never included. Register with `...polyRouterAdaptersFromEnv(process.env)`: `[]` unless `POLYROUTER_ENABLED=true` (needs `POLYROUTER_API_KEY`). Venue table and regulation labels: `src/polyrouter/venues.ts`.

- No order books for long-tail Venues: Quotes come from Market `current_prices`, depth `0`. One shared 100 req/min budget (throttled).
- Outcome id is `<market id>:<outcome id>`. A PolyRouter failure only fails that Venue's sync jobs.
- Fixtures are hand-written from the documented shapes (no key was available to record).
