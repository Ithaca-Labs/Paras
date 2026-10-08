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

## Long tail (native adapters)

Seven read-only adapters, registered together with `...longTailAdaptersFromEnv(process.env)` (api + worker). Shared HTTP helper (`src/http.ts`): spaced requests per Venue rate limit, 404 -> null. A Venue failing only fails its own sync jobs. Keys: `docs/BLOCKERS.md`, "Venue API keys".

| Venue (`id`)                    | API                                                               | Key                                    | Books                                            | History                   | Outcome id                     |
| ------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ | ------------------------- | ------------------------------ |
| Polymarket US (`polymarket-us`) | `gateway.polymarket.us/v1`                                        | none                                   | long book, short = mirror                        | yes                       | `<slug>:long                   | short` |
| Opinion (`opinion`)             | `openapi.opinion.trade/openapi`, 5 req/s                          | none                                   | per token                                        | yes                       | token id                       |
| Myriad (`myriad`)               | `api-v2.myriadprotocol.com`                                       | optional `MYRIAD_API_KEY`              | `ob` Markets only; AMM = listed price, depth 0   | from market detail charts | `<network>:<market>:<outcome>` |
| Probable (`probable`)           | `market-api.` (metadata) + `api.probable.markets` (book, history) | none                                   | per token                                        | yes                       | token id                       |
| Novig (`novig`)                 | `api.novig.com/v3/public/catalog`                                 | none                                   | bids = own orders, asks = other outcome at 1 - p | no                        | `<market>:<outcome>`           |
| Predict.fun (`predict-fun`)     | `api.predict.fun/v1`                                              | `PREDICTFUN_API_KEY` (testnet keyless) | YES book, NO = mirror                            | yes                       | `<market>:yes                  | no`    |
| ProphetX (`prophetx`)           | Market Data API `cash.api.prophetx.co/partner`                    | `PROPHETX_API_KEY`                     | none: buy-only, American odds -> ask             | no                        | `<event>:<market>:<strike_id>` |

- Myriad skips points (`PTS`) Markets (play money). Probable and Predict.fun deep links, and Polymarket US `/market/<slug>`, are unverified guesses at the site URL scheme.
- Fixtures: Polymarket US, Opinion, Myriad, Probable, Novig and Predict.fun are recorded (Predict.fun from the keyless testnet host). ProphetX and Myriad order-book Markets are hand-written from the docs (no key / no live `ob` Market).
- Regulation labels: Polymarket US `cftc_regulated`; Opinion, Myriad, Probable, Predict.fun `offshore`; Novig and ProphetX `unknown` (needs legal confirmation).
