# Paras — Product Requirements Document

> **Source of truth** for product + architecture decisions. Parent tracking issue: [#1](https://github.com/Ithaca-Labs/Paras/issues/1). Update this file (in the same PR) whenever a decision changes. Last updated: 2026-10-09.


## Glossary

- **Venue**: an external prediction market platform (Polymarket, Kalshi, Limitless, SX Bet, …).
- **Market**: one tradeable question on one Venue (e.g. a Polymarket condition, a Kalshi ticker).
- **Outcome**: one side of a Market (YES/NO, or a named option in a multi-outcome Market).
- **Event**: Paras's canonical question. It groups equivalent Markets across Venues, with outcome direction normalized.
- **Quote**: the best bid/ask, depth and fee-adjusted effective price for an Outcome on a Venue at a point in time.
- **Interest Profile**: a user's stated and learned preferences (categories, topics, entities, experience level, risk appetite).
- **Feed**: a ranked, personalized list of Events for one user.
- **Magic Link**: a signed, short-lived URL. It deep-links to an Event page and can carry chat context and a prefilled bet intent.
- **Vault**: the Paras contract on Monad that holds a user's USDC and dispatches it to Venues.
- **Deposit Wallet**: a user's own Polymarket smart wallet on Polygon. Paras's Executor holds only a scoped session key for it.
- **Intent**: a user-signed instruction such as "buy YES on Event E, up to N USDC, at max price P".
- **Executor**: the off-chain service that turns Intents into Venue orders and reports fills.
- **Route**: the Executor's choice of Venue (and Market) for an Intent.

## Problem Statement

Prediction markets are fragmented. The same question trades at different prices on Polymarket, Kalshi and a long tail of smaller Venues. Existing aggregators only mirror prices and order books. They assume you already know what you want to bet on.

A newcomer faces a wall of thousands of markets with no sense of what is relevant to them. That is the cold-start problem. Even experienced users have to hop between sites, compare prices by hand, and keep money on several chains and accounts.

More and more discovery happens inside AI assistants like Claude and Codex. There is no way to ask "what can I bet on about X?" in a chat and land on a page where you can act.

Funding positions is also painful. A user on Monad holding USDC cannot place a Polymarket position without manually bridging, wrapping and managing a separate wallet.

## Solution

Paras is a prediction market aggregator and discovery layer built around Monad. It has four parts.

1. **Aggregation.** Paras pulls Markets from multiple Venues, groups equivalent Markets into Events, and shows a side-by-side, fee-adjusted price comparison. It highlights the best Venue for each Outcome.
2. **Personalized discovery.** A short onboarding flow captures what the user cares about. It covers sports teams, politics, crypto, macro, tech, culture, specific people and companies, experience level and risk appetite. Paras uses this to build a personalized home Feed from the first visit. Implicit signals (views, follows, bets, dismissals) keep refining it.
3. **AI connector (MCP).** A remote MCP server works as a Claude connector and a Codex connector. Users can search, browse trending markets, compare prices, and see their own Feed from chat. Every result includes a Magic Link that opens the exact Event page on Paras, optionally with a prefilled bet. No money moves from chat. Execution always happens on Paras with the user's wallet signature.
4. **Monad Vault.** Users deposit USDC on Monad. When they choose an Event and Outcome, the Vault sends funds to the best eligible Venue and places the position on their behalf. Venue choice uses best fee-adjusted price and available depth. Funds and positions stay segregated per user and are never pooled.
   - **V1** routes to Polymarket only. Funds bridge via Circle CCTP v2 from Monad to the user's own Polymarket Deposit Wallet on Polygon.
   - **Kalshi** is read-only in this spec. Kalshi Events show prices, and "Bet on Kalshi" redirects to Kalshi's website.
   - **End goal:** the Vault routes across Polymarket and Kalshi. The Route interface is built venue-agnostic from day one so Kalshi can plug in later.

Paras serves both US and non-US users. Discovery, the Feed, MCP and price comparison work for everyone. Vault execution is gated by jurisdiction because Polymarket's international exchange blocks or restricts US and several other countries. Ineligible users get redirect links to Venues available to them, such as Kalshi or Polymarket US.

## User Stories

### Onboarding & cold start

1. As a first-time visitor, I want a short onboarding flow, so that the homepage is relevant to me immediately instead of a generic list.
2. As a newcomer, I want to pick broad categories (politics, sports, crypto, economics/macro, tech/AI, culture/entertainment, science, weather), so that my Feed starts in the right areas.
3. As a newcomer, I want to pick specific topics and entities within categories (e.g. "NBA → Lakers", "Fed rate decisions", "Bitcoin price", "US elections"), so that my Feed is precise.
4. As a newcomer, I want to type free-text interests ("I follow F1 and AI startups"), so that I'm not limited to a fixed list.
5. As a newcomer, I want to state my experience level, so that Paras explains concepts (what a price means, how payouts work) at the right depth.
6. As a newcomer, I want to state my risk appetite and typical stake size, so that suggestions match me, for example avoiding illiquid long-shots if I'm conservative.
7. As a newcomer, I want to set a time-horizon preference (resolves this week vs. long-dated), so that I see markets that settle when I want.
8. As a newcomer, I want to skip onboarding and still get a sensible default Feed, so that I'm never blocked.
9. As a user, I want to edit my Interest Profile at any time, so that my Feed changes as my interests change.
10. As a newcomer, I want a short explainer of how prediction markets work during onboarding, so that I understand prices are probabilities.
11. As a user, I want onboarding to work before I connect a wallet, so that I can explore without committing.
12. As a returning user on a new device, I want my Interest Profile restored after I sign in, so that I don't redo onboarding.

### Personalized Feed & discovery

13. As a user, I want a home Feed ranked by my interests, so that the most relevant Events are at the top.
14. As a user, I want the Feed to mix relevance with trending signals (volume spikes, big price moves, closing soon), so that I don't miss important action.
15. As a user, I want each Feed card to show the question, the best price per Outcome across Venues, total volume, and time to resolution, so that I can scan quickly.
16. As a user, I want to see why an Event is in my Feed ("because you follow Fed decisions"), so that I trust and can tune the ranking.
17. As a user, I want to dismiss an Event or say "show fewer like this", so that the Feed learns what I don't want.
18. As a user, I want to follow an Event, topic or entity, so that related Events rank higher and I get updates.
19. As a user, I want the Feed to learn from my views and bets, so that it improves without me editing my profile.
20. As a user, I want browse pages by category and topic, so that I can explore outside my Feed.
21. As a user, I want full-text and semantic search ("will the Fed cut in December"), so that I can find Events even with different wording.
22. As a user, I want filters for Venue, category, resolution date, liquidity and price range, so that I can narrow results.
23. As a user, I want sorts for trending, volume, closing soon, newest and biggest move, so that I can explore in different ways.
24. As a user, I want a "markets for beginners" section of liquid, easy-to-understand Events, so that I can start safely.
25. As a user, I want resolved and closed Events hidden from my Feed by default, so that I only see things I can act on.

### Aggregation & price comparison

26. As a user, I want each Event page to list every Venue offering that question, so that I see the whole market in one place.
27. As a user, I want the best fee-adjusted price per Outcome highlighted, so that I know where my money goes furthest.
28. As a user, I want to see order book depth or liquidity per Venue, so that I know whether my stake size will move the price.
29. As a user, I want an estimated fill price for my stake size per Venue, so that the comparison is realistic, not top-of-book only.
30. As a user, I want price history charts per Venue on one chart, so that I can see trends and divergence.
31. As a user, I want each Venue's resolution rules and source shown side by side, so that I can spot Markets that look identical but settle differently.
32. As a user, I want a visible warning when Paras's match between Markets is low-confidence, so that I don't assume equivalence wrongly.
33. As a user, I want to see when prices were last updated, so that I know how fresh the data is.
34. As a user, I want multi-outcome Events (e.g. "who wins the election") shown with each candidate's best price across Venues, so that complex markets are comparable.
35. As a user, I want Markets that exist on only one Venue to still appear, so that discovery isn't limited to cross-listed questions.
36. As a power user, I want arbitrage-style divergence callouts (same Event, prices differ a lot), so that I can spot opportunities.

### Venue coverage

37. As a user, I want Polymarket Markets with live prices and depth.
38. As a user, I want Kalshi Markets with live prices and depth.
39. As a user, I want Limitless and SX Bet Markets included, so that I see crypto-native and sports liquidity beyond the big two.
40. As a user, I want long-tail Venues (e.g. Myriad, Opinion, Predict.fun, ProphetX, Novig, Polymarket US) included where free data is available, so that coverage is broad.
41. As a user, I want play-money Venues (Manifold) either excluded or clearly labeled, so that I don't confuse them with real-money prices.
42. As a user, I want each Venue labeled with its regulation and availability ("CFTC-regulated, US OK" vs "offshore, US restricted"), so that I know where I can legally trade.

### Accounts & identity

43. As a user, I want to sign in with my Monad wallet (Sign-In With Ethereum), so that my identity matches the wallet that funds the Vault.
44. As a user, I want to sign in with email (passwordless) before I have a wallet, so that discovery works for non-crypto users.
45. As a user, I want to link an email account and a wallet, so that my profile and Vault are one identity.
46. As a user, I want to connect Paras to Claude or Codex through a standard OAuth consent screen, so that the AI acts as me for read-only discovery.
47. As a user, I want to revoke an AI connector's access, so that I stay in control.

### AI connector (MCP) & Magic Links

48. As a Claude user, I want to add Paras as a connector, so that I can ask about prediction markets in chat.
49. As a Codex user, I want to add Paras as an MCP server, so that I get the same features in Codex.
50. As a chat user, I want to ask "what can I bet on about the Fed?" and get matching Events with best prices, so that discovery happens where I already am.
51. As a chat user, I want to ask for trending or closing-soon markets in a category, so that I get timely ideas.
52. As a chat user, I want to compare prices for an Event across Venues in chat, so that I can decide without leaving.
53. As a signed-in chat user, I want "show my Feed" to return my personalized Events, so that the connector knows my interests.
54. As a chat user, I want every Event result to include a Magic Link to its Paras page, so that I can act in one click.
55. As a chat user, I want to say "I want $20 on YES" and get a Magic Link with the bet prefilled, so that execution on Paras is one confirmation away.
56. As a user opening a Magic Link, I want to land directly on that Event page with the context from chat (selected Outcome, amount), so that I don't search again.
57. As a user, I want Magic Links to expire and be tamper-proof, so that nobody can alter the prefilled amount or Outcome.
58. As a user opening a Magic Link while signed out, I want to sign in and then return to the same prefilled page, so that the flow isn't broken.
59. As a signed-in chat user, I want to ask "what's in my Vault?" and see balances and open positions read-only, so that I can check status from chat.
60. As a user, I want to be sure the AI connector can never move my money, so that I trust it.
61. As a chat user, I want the connector to tell me when a Venue is unavailable in my jurisdiction, so that I don't get links I can't use.

### Vault — deposits & funding

62. As a user, I want to deposit USDC on Monad into the Vault, so that I can fund bets without handling multiple chains.
63. As a user, I want to see my Vault balance split into idle, in-flight (bridging or ordering) and deployed in positions, so that I know where my money is.
64. As a user, I want my funds kept separate from other users' funds, so that I'm not exposed to anyone else's positions or losses.
65. As a user, I want to withdraw idle USDC from the Vault at any time, so that I keep custody.
66. As a user, I want a Polymarket Deposit Wallet created for me automatically on first use, so that I don't set up Polymarket myself.
67. As a user, I want my Deposit Wallet owned by my own key, with Paras holding only a limited, expiring session key, so that Paras can't steal my funds.
68. As a user, I want to see deposit and bridge status with expected time, so that I know when funds are ready.

### Vault — placing bets (Intents & routing)

69. As a user, I want to choose an Event, Outcome, amount and max price and sign one Intent, so that the Vault handles bridging and ordering for me.
70. As a user, I want the Vault to route my Intent to the Venue with the best fee-adjusted expected fill, so that I get the best position available.
71. As a user, I want to see the chosen Route, expected fill price, fees and estimated shares before I sign, so that there are no surprises.
72. As a user, I want my max price respected, with any unfilled remainder returned or left as a resting order per my choice, so that I never pay more than I agreed.
73. As a user, I want an Intent to expire if it can't execute within a window, with funds returned to idle, so that money isn't stuck.
74. As a user, I want to cancel a pending Intent, so that I can change my mind before execution.
75. As a user, I want notifications when my Intent fills, partially fills or fails, so that I'm informed.
76. As a user in V1, I want routing limited to Polymarket, with the UI telling me when a better Kalshi price exists and linking me to Kalshi, so that I still benefit from the comparison.
77. As a future user, I want the Vault to route between Polymarket and Kalshi automatically, so that I always get the best Venue.

### Vault — positions, exits & settlement

78. As a user, I want a portfolio view of all positions across Venues (Vault-placed), with current value and P&L, so that I can track performance.
79. As a user, I want to sell (exit) a position before resolution through the Vault, so that I can take profit or cut losses.
80. As a user, I want winning positions redeemed automatically on resolution and the proceeds made available, so that I don't redeem by hand.
81. As a user, I want proceeds bridged back to my Monad Vault balance automatically (or left on Polygon if I choose), so that funds return home.
82. As a user, I want a full history of deposits, Intents, fills, redemptions and withdrawals with on-chain transaction links, so that I can audit everything.
83. As a user, I want to see when a Market is under dispute or delayed in resolution, so that I understand why funds haven't returned.

### Jurisdiction & compliance

84. As a US user, I want full discovery, Feed, MCP and price comparison, so that Paras is useful even where I can't use the Vault.
85. As a US user, I want "Bet" buttons to redirect me to Venues legally available to me (Kalshi, Polymarket US), so that I can act compliantly.
86. As a user in a restricted country, I want to be told clearly that Vault execution isn't available to me, so that I don't deposit funds I can't use.
87. As an operator, I want Vault execution gated by geolocation plus self-attestation, so that Paras follows Venue terms.
88. As a user, I want clear risk disclosures before my first deposit, so that I understand the risks of bridges, Venues and resolution.

### Kalshi (read-only)

89. As a user, I want Kalshi Markets on Event pages with live prices, so that my comparison is complete.
90. As a user, I want a "Bet on Kalshi" button that opens the exact Kalshi market page, so that I can trade there easily.
91. As a user, I want Kalshi's best price highlighted even though it isn't Vault-routable, so that the comparison stays honest.

### Notifications & engagement

92. As a user, I want alerts when a followed Event moves sharply or nears resolution, so that I can act in time.
93. As a user, I want a weekly digest of new Events matching my interests, so that I come back.
94. As a user, I want to choose notification channels (email, in-app) and frequency, so that alerts aren't noisy.

### Operator / admin

95. As an operator, I want a review queue of low-confidence cross-Venue matches, so that a human can confirm or reject Event groupings.
96. As an operator, I want to manually merge, split or relabel Events, so that matching errors can be fixed.
97. As an operator, I want health dashboards per Venue adapter (freshness, error rate), so that I spot outages.
98. As an operator, I want to pause Vault execution globally or per Venue, so that I can respond to incidents.
99. As an operator, I want Executor session keys to be rotatable and narrowly scoped, so that a compromise has limited impact.
100. As an operator, I want builder-fee attribution on Polymarket orders, so that Paras earns revenue on routed volume.

## Implementation Decisions

### Platform & stack
- Everything must run on free tiers or self-hosted, open-source components. Paid data vendors are not on the critical path.
- **Build order: backend first, frontend last.** The API, worker, MCP, contracts and Executor ship first, each verified at its test seam. The web app is built only after the user provides brand assets (logo, banner, colors, fonts). Backend issues expose everything the UI will need as API endpoints.

### System architecture

```
                      ┌──────────── Clients ─────────────┐
                      │ Web (Next.js, built LAST)        │
                      │ Claude / Codex (MCP connector)   │
                      └───────┬──────────────────┬───────┘
                       REST+SSE│                  │MCP (Streamable HTTP + OAuth)
                              ▼                  ▼
┌──────────── apps/api ───────────────┐   ┌── apps/mcp ──────────────┐
│ Fastify REST /v1 (OpenAPI from zod) │◄──│ thin: calls api via typed │
│ auth: SIWE, email OTP, sessions,    │   │ client; validates OAuth   │
│ OAuth 2.1 AS (MCP clients)          │   │ bearer tokens; read-only  │
│ SSE live Quotes; Magic Links        │   └───────────────────────────┘
│ admin endpoints (review, pause)     │
└───────┬─────────────────────────────┘
        │ uses packages/domain (pure logic: pricing, matching, ranking,
        │ routing, eligibility) + packages/db
        ▼
┌──────────── Postgres (+pgvector) ───────────────────────────────────┐
│ system of record · latest-quote table · QuoteSnapshots · embeddings │
│ pg-boss job queue (no Redis in V1)                                  │
└───────▲──────────────────────────────▲──────────────────────────────┘
        │                              │
┌───────┴──── apps/worker ─────┐  ┌────┴──── apps/executor ──────────────────┐
│ Venue sync (packages/        │  │ ONLY service with signing keys            │
│ adapters): Polymarket,       │  │ watches Vault Intents (Monad) → Route →   │
│ Kalshi, Limitless, SX Bet,   │  │ CCTP burn → attestation → mint (Polygon)  │
│ PolyRouter(flag)             │  │ → wrap pUSD → CLOB order (POLY_1271)      │
│ embeddings (transformers.js) │  │ → fills/exits/redeem → CCTP back          │
│ matching, tagging, alerts,   │  │ Polygon indexer (viem log polling)        │
│ digests                      │  └────┬──────────────────────┬──────────────┘
└──────────────────────────────┘       ▼                      ▼
                              Monad: Vault contract     Polygon: Deposit Wallets,
                              (contracts/, Foundry)     CTF, Polymarket CLOB
```

- **Monorepo:** pnpm workspaces plus Turborepo. Deployables: `apps/api`, `apps/worker`, `apps/mcp`, `apps/executor` and `apps/web` (built last). Libraries:
  - `packages/domain`: pure logic, no I/O
  - `packages/adapters`: Venue adapters
  - `packages/db`: Drizzle ORM and migrations
  - `packages/shared`: zod schemas, types, generated API client
  - `contracts`: Foundry
- **API style:** REST JSON versioned under `/v1`, with an OpenAPI 3.1 spec generated from zod schemas. The MCP server and the future web app both use the generated typed client, so the API is the single contract. Live Quotes are pushed over Server-Sent Events.
- **Data and jobs:** Postgres 16 with pgvector holds everything. pg-boss (Postgres-backed) runs jobs: sync, matching, alerts, Executor steps. The hot latest-Quote table lives in Postgres, with an in-process LRU cache. Redis is added only if load measurements demand it.
- **Business logic:** all domain rules live in `packages/domain` as pure functions. Apps only wire I/O to them. That keeps the 4 seams sufficient and the logic reusable across api, worker and executor.
- **Embeddings:** a self-hosted open-source sentence model (e.g. bge-small or MiniLM) runs via transformers.js in the worker. It's free, with no external API. LLM match verification is optional and behind a flag and budget.
- **Chain access:** viem for Monad and Polygon, on free-tier RPCs with fallback. The Polygon indexer uses log polling, not a paid indexer.
- **Key custody:** only `apps/executor` holds signing material (Executor session keys and the dispatch key). In V1 testnet, keys are encrypted at rest with an env master key. A KMS-backed signer is required before mainnet, as part of the launch gate. The API and worker never sign transactions.
- **Email:** passwordless OTP and digests go through a free-tier transactional email provider behind an interface, with a console transport in dev and test.
- **Runtime:** Node 22 LTS, TypeScript strict. Every app ships as a Docker image. Local dev uses docker-compose (Postgres+pgvector plus all apps). The hosting provider is not decided; it must have a free or cheap tier and run Docker.
- **Observability:** pino structured logs with request and Intent correlation IDs, plus a `/health` endpoint on every app. Admin endpoints expose Venue freshness and error rates.
- **CI:** GitHub Actions runs on every PR and every push to `main`. Jobs: `node` (install, lint, typecheck, test with a Postgres+pgvector service) and `contracts` (forge build/test). A PR may be merged only when CI is green. GitHub branch protection is intentionally not enabled; the rule is enforced by the workflow described in CLAUDE.md.

### Module: Venue adapters (deep module)
- One interface per Venue. Each normalizes into the shared Market, Outcome and Quote schema: list/sync Markets, fetch Quotes and order book, fetch price history, provide a deep link URL, and report capabilities (read-only vs. routable, regulation, jurisdictions).
- **Data sourcing (free first, reliability second):**
  - Polymarket (Gamma + CLOB public endpoints and WebSocket), Kalshi (public market data API), Limitless and SX Bet use native adapters against their free public APIs. These are the most reliable sources and need no paid vendor.
  - Long-tail Venues come through a single PolyRouter-backed adapter (free beta) behind the same interface. It is optional and feature-flagged, so a PolyRouter outage only degrades long-tail coverage.
  - Manifold is excluded from the default Feed. If included, it is labeled play-money.
- Adapters are pure translators with no ranking or matching logic. This keeps them testable with recorded fixtures.
- The interface is `VenueAdapter` in `packages/adapters/src/types.ts`; the normalized schema (Market, Outcome, OrderBook, Quote, PricePoint, FeeSchedule, capabilities) is zod in `packages/shared/src/venue.ts`. How to add a Venue: `packages/adapters/README.md`.

### Module: Ingestion & Quote service
- A scheduled sync handles Market metadata. WebSocket or short-interval polling handles Quotes for active Markets, prioritized by volume and by Markets users have open or follow.
- Quotes are stored as rolling snapshots for history charts. The latest Quote is cached for fast reads.
- Fee-adjusted effective price is computed per Venue fee model. Size-aware estimated fill is computed by walking the order book.

### Module: Event matching (deep module)
- Input: normalized Markets. Output: Events with linked Markets, normalized Outcome direction, and a confidence score.
- Pipeline:
  1. Generate candidates by embedding similarity on title, description and rules, using a free, self-hosted open-source embedding model.
  2. Apply hard gates: resolution date window, matching strikes/thresholds, same entity, no opposite-direction wording, same event stage.
  3. Run an optional LLM verification pass, behind a flag and budget.
  4. Auto-link high-confidence matches. Send medium confidence to the operator review queue. Keep low-confidence matches as separate Events.
- Operator overrides (merge/split) are persisted and always win over automatic matching.
- Equivalence shown to users always carries the confidence level and side-by-side resolution rules.

### Module: Interest Profile & Feed ranking (deep module)
- The Interest Profile stores explicit selections (categories, topics, entities, free text embedded to vectors, experience level, risk appetite, horizon) and implicit signals (views, follows, dismissals, bets) with time decay.
- Events get category, topic and entity tags at ingestion from Venue categories plus embedding classification against a curated taxonomy.
- Feed score is a weighted blend of interest similarity, trending signals (volume delta, price move, closing soon), liquidity floor (stricter for conservative or beginner users), freshness, and a diversity penalty to avoid one-topic Feeds. Each item carries a human-readable reason.
- Cold start: onboarding gives explicit vectors immediately. Users who skip get a popularity-plus-diversity default Feed.
- V1 ranking is deterministic and heuristic, with tunable weights. A learned ranking model is out of scope.

### Module: Identity & auth
- Sign-In With Ethereum for wallets and passwordless email login. Both link to one user record.
- OAuth 2.1 authorization server (with dynamic client registration) for MCP clients. Scopes:
  - `markets:read` (no login needed for public tools)
  - `feed:read`
  - `portfolio:read`
- There is no write or trade scope, by design.

### Module: Magic Links
- A Magic Link is a signed, short-lived token that encodes target Event, optional Outcome, optional amount, optional max price, originating client (Claude/Codex), and an optional user binding.
- The token is verified server-side and is tamper-evident. Opening it loads the Event page prefilled. It never auto-executes, and the user must sign the Intent on Paras.
- If the user is signed out, sign-in preserves the token and returns them to the prefilled page.

### Module: MCP server
- Remote MCP over Streamable HTTP, usable as a Claude custom connector and a Codex MCP server.
- Tools (all read-only):
  - `search_events(query, filters)`
  - `get_event(event_id)`, which includes the per-Venue comparison
  - `list_trending(category?, window?)`
  - `list_closing_soon(category?)`
  - `compare_prices(event_id, outcome, stake?)`
  - `get_my_feed()`, auth required
  - `get_portfolio()`, auth required
  - `create_magic_link(event_id, outcome?, amount?, max_price?)`
- Every Event result includes a Magic Link and the user's jurisdiction-aware availability per Venue.
- The MCP server calls the backend API only. It contains no business logic, so it stays a thin seam.

### Module: Vault contracts (Monad)
- Per-user segregated accounting, not a pooled ERC-4626 share vault. Each user has idle, reserved (in-flight) and withdrawn balances in USDC. There are no pooled shares or NAV. This avoids fund-style pooling and cross-user loss exposure.
- Core external interface:
  - deposit, withdraw (idle only)
  - submit Intent (EIP-712 signed by the user)
  - cancel Intent (before dispatch)
  - Executor-only dispatch: reserves funds and initiates a CCTP v2 burn whose mint recipient must equal the user's registered Deposit Wallet
  - Executor-only settle/return, which credits funds returned from Polygon
  - operator pause
- Invariants:
  - The Executor can only move a user's funds to that user's own Deposit Wallet, and only against a valid, unexpired, user-signed Intent.
  - Funds can never go to an arbitrary address.
  - Withdrawals go only to the user.
- Deposit Wallet address registration is bound to the user's signature.
- Upgradeability uses a transparent or UUPS proxy behind a timelock and multisig. Pause is immediate, unpause is timelocked.

### Module: Executor (off-chain)
- Watches Vault Intents, computes the Route (V1: Polymarket only) and checks max price and depth.
- Dispatches the CCTP burn, waits for the attestation, mints on Polygon to the Deposit Wallet, and wraps to Polymarket's collateral token.
- Places the order via the CLOB using EIP-1271 contract signatures through a scoped, expiring session key, with Polymarket builder attribution.
- Handles partial fills, rest-or-return per the Intent, exits (sells), and automatic redemption on resolution. It bridges proceeds back via CCTP to the user's Vault balance.
- Session key scope covers: place and cancel orders, wrap and unwrap collateral, redeem, and bridge only to the user's own Monad Vault account. No arbitrary transfers.
  - **Enforcement caveat (decision #36):** on Polygon in V1 this scope is enforced off-chain by the Executor policy layer (`apps/executor/src/wallet/policy.ts`, deny-by-default allowlist) and by Polymarket's relayer, NOT on-chain (stock session keys are unscoped on-chain, see Vault risk findings 2b). On Monad (Vault) it is enforced on-chain. Option A (per-user PolicyOwner) moves Polygon enforcement on-chain.
- Polygon indexer tracks Deposit Wallet collateral and outcome token balances. Portfolio and P&L are computed from it. Monad-side balances are claims, not proof of collateral.
- Every state transition is recorded idempotently, so retries and restarts are safe.
- The Executor runs from an IP in a Polymarket-permitted jurisdiction.

### Routing interface (venue-agnostic)
- A Route is computed from the Intent plus current Quotes across routable Venues. Each Venue capability declares whether it is routable and for which jurisdictions.
- V1 has a single routable Venue (Polymarket). Kalshi is declared read-only with a redirect deep link.
- The interface takes a list of routable Venues and returns a Route with expected fill, fees and Venue, or a "no eligible route" result with redirect suggestions.
- **Future Kalshi routing** requires per-user Kalshi accounts through a licensed intermediary (FCM-backed broker API) or DFlow tokenized Kalshi on Solana for eligible users. Either option needs legal review first. A pooled omnibus Kalshi account is explicitly rejected.

### Jurisdiction gating
- Geolocation (IP) plus user self-attestation of country at first deposit.
- An eligibility matrix maps country to the Venues that are routable or redirectable. Polymarket's international geoblock list drives Vault eligibility.
- US users are not eligible for Vault execution on Polymarket's international exchange. They get redirects to Kalshi and Polymarket US.

### Data model
Entities:
- User
- WalletLink
- InterestProfile
- InteractionSignal
- Venue
- Market
- Outcome
- QuoteSnapshot
- Event
- EventMarketLink, with confidence, direction and source (auto or operator)
- Tag/Taxonomy
- Follow
- MagicLinkToken (audit)
- OAuthClient/Grant
- DepositWallet
- Intent, with state machine
- Fill
- Position
- BridgeTransfer
- Notification

Intent state machine:

```
signed → dispatched → bridging → bridged → ordering
  → filled | partially_filled | failed | expired | cancelled
then (filled | partially_filled) → (exited | redeemed) → returning → settled
```

### Revenue
- Polymarket builder fees on routed orders.
- No fees on discovery or MCP in this spec.

## Testing Decisions

- A good test exercises external behavior through a seam: an HTTP request and response, an MCP tool call and result, a contract call and its emitted events and state, or an Intent in and on-chain/CLOB effects out. Tests never assert internal function calls or private state. Venue data comes from recorded fixtures, never live calls, in CI.
- **Seam 1: Backend HTTP API.** Covers Feed, search, Event pages and comparison, onboarding and Interest Profile, Magic Link create/resolve, auth, and portfolio read.
  - Runs against a real Postgres (containerized) with Venue adapters replaced by fixture-backed fakes implementing the adapter interface.
  - Feed ranking, Event matching, fee-adjusted pricing and jurisdiction gating are all verified through this seam. Examples: given this Interest Profile and these fixture Markets, the Feed returns X first with reason Y; given these two Markets, the Event page shows them linked with confidence Z.
  - Each Venue adapter also gets a small fixture-replay test proving normalization. That is the one allowed lower-level test, since adapters are the boundary to the outside world.
- **Seam 2: MCP tools.** Tested through a real MCP client against the MCP server wired to the Seam 1 API, with fixtures. Asserts tool schemas, results, Magic Link presence and validity, auth scope enforcement, and that no write tools exist.
- **Seam 3: Vault contracts.** Foundry tests through external functions only.
  - Deposit/withdraw, Intent signature validation, expiry and cancel.
  - Executor-only dispatch with the mint-recipient invariant, settle/return, and pause/timelock.
  - Fuzz and invariant tests: a user's funds only ever go to that user or their Deposit Wallet. The sum of user balances equals contract USDC minus in-flight.
  - Fork tests against Monad for real CCTP v2 contracts.
- **Seam 4: Executor.** End-to-end Intent lifecycle against a Polygon fork plus Polymarket's non-production/staging CLOB where available, and a mocked CCTP attestation service.
  - Asserts the full state machine: fill, partial fill, max-price rejection, expiry refund, exit, redemption and return bridge.
  - Asserts idempotency under injected restarts.
- **Prior art:** none. The repository is empty (greenfield). The first slices should establish the fixture-recording harness and the containerized-Postgres API test harness that all later tests reuse.

## Out of Scope

- Kalshi execution in any form (read-only plus redirect only), and execution on any Venue other than Polymarket in V1.
- Trade execution from inside Claude or Codex chats. MCP is read-only plus Magic Links.
- Autonomous strategies, where the Vault chooses what to bet on. The user always picks the Event, Outcome and amount. The Vault only chooses the Venue.
- Pooled vault shares, copy-trading, social features, leaderboards and comments.
- Paid data vendors (Oddpool, FinFeedAPI, etc.) and a learned recommendation model.
- Native mobile apps.
- Fiat on-ramps.
- Non-USDC deposits and chains other than Monad as the deposit chain.
- Creating new markets on Paras.
- Full KYC. Jurisdiction gating is geolocation plus attestation only, pending legal review.

## Further Notes

- **Research findings (Oct 2026):**
  - Polymarket and Kalshi hold over 97% of prediction market volume.
  - Limitless (Base) and SX Bet have the most accessible free APIs among the rest. Opinion, Predict.fun/Probable, Myriad, ProphetX, Novig and Polymarket US are tier-2, reached via PolyRouter.
  - No prediction market Venue is confirmed live on Monad itself. Paras on Monad is the Monad angle.
  - Robinhood resells Kalshi, so skip it. PredictIt, Drift BET, Zeitgeist, Augur and Hedgehog are small or unverified.
- **Vault feasibility:**
  - Native USDC and Circle CCTP v2 are live on Monad.
  - Polymarket supports contract-wallet trading (EIP-1271 signature type on CLOB v2), per-user deposit wallets via its builder relayer, and scoped session keys.
  - Polymarket's collateral moved from USDC.e to pUSD (a USDC wrapper) in April 2026.
  - Builder tiers limit relayer throughput (the unverified tier is 100 relays/day). Apply for verified builder status early.
- **Risks to verify before building the Vault:**
  1. CCTP v2 direct Monad→Polygon route availability.
  2. An open report of CLOB rejecting EIP-1271 orders when the API key is bound to the owner EOA rather than the wallet. Test on staging first.
  3. Polymarket Terms of Use regarding third-party operators trading for users.
  4. **Regulatory:** event contracts are swaps under the CEA, and acting for others may raise CPO/CTA or intermediary questions even with per-user segregation. Get CFTC/securities counsel review before mainnet Vault launch. Per-user segregation and user-chosen positions were chosen specifically to reduce this risk.
- **Settlement latency:** bridging plus UMA resolution and disputes means minutes to days. The UX must show in-flight states honestly.
- **Suggested slice order:**
  1. Polymarket and Kalshi adapters plus the API with Event pages.
  2. Event matching plus the review queue.
  3. Onboarding plus Feed.
  4. MCP plus Magic Links.
  5. Vault contracts (testnet).
  6. Executor on staging.
  7. Jurisdiction gating plus mainnet behind a flag.

## Issue map (implementation slices)

Each slice is a sub-issue of #1. Start an issue only once every issue in its "Blocked by" list is closed.

| # | Slice | Blocked by |
|---|---|---|
| #2 | Foundation: monorepo, CI, test harnesses | — |
| #3 | Polymarket adapter + ingestion + Event page (tracer) | #2 |
| #4 | Kalshi adapter (read-only) + redirect | #3 |
| #5 | Cross-Venue price comparison | #4 |
| #6 | Event matching + review queue | #5 |
| #7 | Limitless + SX Bet adapters | #3 |
| #8 | Long-tail via PolyRouter + regulation labels | #3 |
| #9 | Search & browse | #3 |
| #10 | Identity: SIWE + email + linking | #2 |
| #11 | Onboarding + Interest Profile | #10, #9 |
| #12 | Personalized Feed | #11, #5 |
| #13 | Magic Links | #3, #10 |
| #14 | MCP public tools | #13, #9, #5 |
| #15 | MCP OAuth + personal tools | #14, #12 |
| #16 | Jurisdiction gating | #4, #10 |
| #17 | Spike: Vault risks | #2 |
| #18 | Vault contracts + deposit UI | #17, #16 |
| #19 | Deposit Wallets + session keys | #17, #10 |
| #20 | Executor: buy path | #18, #19, #5 |
| #21 | Executor: exits, redemption, portfolio | #20 |
| #22 | Notifications | #12 |
| #23 | Ops: health + pause | #20 |
| #24 | Mainnet launch gate (HITL) | #21, #23, #30 |
| **Frontend (built last)** | | |
| #25 | Brand assets from user (HITL) | — |
| #26 | Web foundation + design system + auth UI | #25, #10 |
| #27 | Discovery UI | #26, #5, #6, #9, #16 |
| #28 | Onboarding + Feed + notifications UI | #26, #11, #12, #22 |
| #29 | Magic Link landing + connected apps UI | #26, #13, #15 |
| #30 | Vault UI | #26, #16, #18, #20, #21 |
| #31 | Admin UI | #26, #6, #23 |

Parallel backend tracks after #2: discovery (#3→#4→#5→#6, #7, #8, #9), identity (#10→#11→#12), Vault (#17→#18/#19→#20). The frontend (#26–#31) starts only after the backend it depends on is merged and #25 (assets) is closed.

## Vault risk findings

Spike #17 (2026-10-09). Evidence: public RPCs (Monad 143, Polygon 137, Monad testnet 10143), Circle Iris API, verified Deposit Wallet source (Sourcify), and Foundry fork tests on live Polygon/Monad state. Scripts: `spikes/17/` (throwaway, not in CI). No funds and no Polymarket credentials were used.

| # | Risk | Verdict |
|---|---|---|
| 1 | CCTP v2 Monad to Polygon | **GO** |
| 2a | POLY_1271 orders and API key binding (py-clob-client-v2 #77) | **CONDITIONAL GO**: needs a live test with a real Deposit Wallet |
| 2b | "Scoped" session key | **NO-GO as designed**: no on-chain scope. Workaround below |
| 2c | USDC to pUSD wrap on Polygon | **GO with design change**: native USDC cannot be wrapped; swap to USDC.e first |
| 2d | Builder relayer and tier limits | **GO**, apply for Verified early |
| 2e | Geoblock for an operator server | **GO**, constraints below |
| 3 | Polymarket ToS on third-party operators | **UNRESOLVED**: legal text not retrievable; HITL |

### 1. CCTP v2 Monad to Polygon: GO

- Domains: Monad **15**, Polygon PoS **7** (read from `localDomain()` on-chain). Both support standard transfer, forwarding service and upfront fees (Monad testnet lacks upfront fees). Fast Transfer is "N/A" on both: standard attestation is already quick.
- Contracts: identical address on both chains and both directions. Verified on-chain: code present, `localMinter` set, `remoteTokenMessengers` cross-registered, and `getLocalToken` maps Monad USDC to Polygon USDC and back.

| Contract | Mainnet (Monad 143 and Polygon 137) | Testnet (Monad 10143 and Amoy 80002) |
|---|---|---|
| TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xfd78EE919681417d192449715b2594ab58f5D002` | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |

- Native USDC (6 decimals): Monad `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, Polygon `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`; testnet Monad `0x534b2f3A21130d7a60830c2Df862319e593943A3`, Amoy `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`. Testnet: TokenMessenger code and `localDomain()` confirmed on Monad testnet (15) and Amoy (7).
- **Fees:** Iris `GET /v2/burn/USDC/fees/15/7` and `/7/15` returned `minimumFee: 0` for both finality thresholds (1000 and 2000). Circle docs: standard transfer is 0 bps. The real cost is destination gas (POL on Polygon, MON on Monad) for `receiveMessage`, unless the Forwarding Service is used (adds a fee; not needed).
- **Latency (Circle docs, not measured live):** Monad standard about 5 s (1 confirmation), Polygon standard about 8 s (2-3 confirmations). Live burn-to-mint timing needs real USDC; see follow-up.
- **mintRecipient:** a `bytes32` with no constraint. Fork tests: `depositForBurnWithHook` on Monad with a contract recipient emits `MessageSent`. On Polygon, delivery via `handleReceiveFinalizedMessage` (impersonating MessageTransmitterV2, i.e. the post-attestation step) mints native USDC straight to a contract with no callbacks. The recipient need not be deployed at mint time, so a counterfactual Deposit Wallet address works.
- **Hooks:** `hookData` is opaque metadata in the signed message; CCTP v2 core never executes it. Nothing can auto-wrap on arrival, so wrapping needs a separate wallet batch (see 2c).
- **destinationCaller:** use `bytes32(0)` on the outbound burn (permissionless relay, so the user is never stuck if the Executor is down; the mint goes only to `mintRecipient`). Use `destinationCaller = Vault` on the return burn.
- **Design change for #18/#20 (return path):** Vault `settle` must not trust Executor-supplied `(user, amount)`. The Executor submits `(message, attestation)` to the Vault; the Vault calls `MessageTransmitterV2.receiveMessage` itself, decodes the BurnMessageV2 and credits the user mapped from the burn's `messageSender` (the registered Deposit Wallet) by the minted amount. `mintRecipient = Vault`, `destinationCaller = Vault`. This binds credits to the burning wallet on-chain and keeps `sum(balances) == USDC held - in-flight`.

### 2a. POLY_1271 and API-key binding (py-clob-client-v2 #77): CONDITIONAL GO

- Signature types: 0 EOA, 1 POLY_PROXY, 2 GNOSIS_SAFE, 3 DEPOSIT_WALLET (SDK name `POLY_1271`). Type 3 is the default for accounts deployed on or after 2026-05-04.
- SDK source (`py_clob_client_v2` 1.1.0, `order_builder/builder.py`): for type 3 the order `signer` and `maker` are the Deposit Wallet (`_v2_order_signer` returns `funder`). L1 auth (`create_or_derive_api_key`) always signs `ClobAuth` with the EOA, so the API key is bound to the **signer EOA**. Docs (`trading/wallets-auth`) say this is by design: "The CLOB API key is bound to the signer address, not the wallet address".
- Issue #77 (opened 2026-05-24, still OPEN): order rejected with `the order signer address has to be the address of the API KEY`. The only comment (2026-07-03) says it works with the stock client on a genuine deployed wallet (`signature_type=3`, `funder` = wallet, EOA key), that EOA key binding is expected, and that a wrong `signature_type` (1) derives a key reporting 0 balance.
- **Our probe (2026-10-09, `spikes/17/clob_auth_probe.py`, throwaway EOA, fake undeployed wallet, no funds):** API key creation succeeded; the order post returned exactly `the order signer address has to be the address of the API KEY`. This is consistent with both "still broken" and "no wallet registered for this signer", so it neither reproduces nor refutes #77 for a real wallet. A real test needs a deployed Deposit Wallet, which only Polymarket's factory operators (the relayer) can create.
- Verdict: proceed assuming the July report is right; gate #19/#20 acceptance on a live staging test (follow-up HITL issue). Fallback if it fails: the session-signer flow (the session key does its own L1 auth and gets its own API key, `POLY_ADDRESS` = session signer, order maker/signer = wallet); if that also fails, escalate to builder@polymarket.com. Do not fall back to type 1/2 (legacy, not creatable for new users).

### 2b. Session keys: NO-GO as "scoped", workaround required

The `DepositWallet` implementation `0xf7f27C29e60fe6325beF8dA7F93250353d2e3294` (beacon `0x7A18EDfe055488A3128f01F563e5B479D92ffc3a`, factory `0x00000000000Fb5C9ADea0298D729A0CB3823Cc07`, timelock delay 3600 s) is verified on Sourcify. Fork tests against the real contracts (`spikes/17/test/DepositWalletFork.t.sol`, 6 pass):

- `execute` is `onlyFactory`, and the factory's `proxy` and `deploy` are `onlyOperator`. **The Executor cannot submit anything on-chain itself**; every wallet action goes through Polymarket's relayer.
- A session signer (`authorizeSessionSigner(addr, validUntil)`, set by an owner-signed batch) can sign batches that call **any target except the wallet itself and the beacon**. Test `test_sessionSignerCanTransferToArbitraryAddress`: a session-signed batch `pUSD.transfer(attacker, 1000e6)` succeeds. It cannot self-call (so it cannot rotate the owner or add signers); unauthorized and expired signers are rejected.
- The `CLOB`, `COMBOSRFQ`, `ALL` scopes in the docs are **not on-chain**. They are enforced by Polymarket's relayer/CLOB, with no documented target allowlist. Validity is fixed at now + 180 days (other values are rejected). The feature is beta and needs a Builder API key plus contact with builder@polymarket.com. The docs claim a session key "cannot withdraw", which is true only of the owner-only `withdrawERC20` path.
- The docs do not say whether the relayer accepts session-signed `WALLET` batches (needed for wrap, redeem and bridge-back). Unknown.
- Owner-only escape hatch: `pause()` then, after the 1 h timelock, `withdrawERC20/1155/Native` to any address. The owner may be an ERC-1271 contract (`SignatureVerifierLib` tries ECDSA, then falls back to `isValidSignature` on a deployed owner).

**Consequence:** the non-negotiable "Executor can only move a user's funds to that user's own Deposit Wallet or back to that user" is enforceable on Monad (Vault) but **not on Polygon with Polymarket's session keys**. #19's acceptance criterion "session key cannot transfer to arbitrary address" cannot be met on-chain with the stock wallet.

**Decision (user, 2026-10-09, #36): B now, A later.** Options:
- **A. Policy owner contract (recommended hardening):** make the wallet `owner` a per-user Paras `PolicyOwner` ERC-1271 contract. Its `isValidSignature(digest, sig)` accepts (i) the user's EOA for anything, and (ii) the Executor key only if the signature payload carries a batch whose recomputed digest matches and whose calls pass an allowlist (approve to Onramp/exchanges, swap/wrap into the wallet itself, CTF redeem, CCTP burn with `mintRecipient = Vault`). This gives real on-chain scope without relying on beta session keys. Unknowns: whether the CLOB accepts a contract owner (L1 auth is ECDSA by the signer EOA), and whether the relayer accepts batches signed this way. Needs a follow-up spike with Polymarket access.
- **B. Stock session key plus off-chain controls (V1 fallback):** the Executor holds only a `CLOB`-scope session key. Non-CLOB steps go through owner-signed batches by the user (UX cost) or, if the relayer accepts it, session-signed batches. Blast radius is limited by: the Vault dispatches only the Intent amount; proceeds are swept back after each fill; KMS signer, per-key spend limits and alerting; rotation by `revokeSessionSigner` (owner batch) and re-authorize before the 180-day expiry; emergency pause plus timelocked withdraw by the owner.
- **C. Executor-controlled owner key:** rejected, equals custody.

### 2c. pUSD wrap: GO with design change

- Addresses (Polygon, code verified on-chain): pUSD proxy `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` (6 decimals), CollateralOnramp `0x93070a847efEf7F70739046A929D47a521F5B8ee`, CollateralOfframp `0x2957922Eb93258b93368531d39fAcCA3B4dC5854`, PermissionedRamp `0xebC2459Ec962869ca4c0bd1E06368272732BCb08` (witness-signed; not usable by us), CTF `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`, CTF Exchange `0xE111180000d2663C0091e4f400237545B87B996B`, Neg Risk Exchange `0xe2222d279d744050d28e00520010520000310F59`, V2 Exchange `0xe3333700cA9d93003F00f0F71f8515005F6c00Aa`, PositionManager `0x006F54F7f9A22e0000CC2AB60031000000ae9fEF`.
- `Onramp.wrap(address asset, address to, uint256 amount)` is permissionless (approve the **Onramp**, not pUSD; `to` can be any address). **`paused(native USDC)` is `true` on mainnet today; `paused(USDC.e 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174)` is `false`.** CCTP mints **native** USDC, so it cannot be wrapped directly (fork test `test_nativeUsdcWrapIsPaused`).
- **Working path (fork test `test_swapNativeToUsdceThenWrap`):** native USDC to USDC.e via Uniswap V3 SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`, fee tier 100 pool `0xD36ec33c8bed5a9F7B6630855f1533455b98a418` (about 126M USDC / 110M USDC.e), then `Onramp.wrap(USDC.e, wallet, out)`. 10,000 USDC returned 9,999.08 pUSD (about 0.9 bps). Return path: `Offramp.unwrap` to USDC.e, swap to native USDC, CCTP burn.
- Impact on #19/#20: Route steps become burn, mint, swap, wrap, order (and the reverse), all as wallet batches via the relayer (one batch can hold approve + swap + approve + wrap). Pool depth and the pause on native USDC are external risks: monitor `Onramp.paused(native)`; if Polymarket re-enables native wrap, drop the swap. A slippage cap on the swap (`amountOutMinimum`) is mandatory. Intent preview fees must include about 1 bps swap cost.

### 2d. Builder relayer and tier limits: GO

- Relayer `https://relayer-v2.polymarket.com`: `WALLET-CREATE` (deploy; `to` = factory; poll to `STATE_CONFIRMED`; returns `proxyAddress`) and `WALLET` (EIP-712 `Batch`, domain `DepositWallet` v1 chain 137, wallet nonce from `/v1/account/transactions/params`). Auth: Builder HMAC headers (`POLY_BUILDER_*`) or Relayer API key headers.
- Limits: Unverified **100 relayer txs/day**, Verified **10,000/day** (manual approval via builder@polymarket.com), Partner unlimited. `/submit` is also capped at 25 requests/min. Rough estimate of 2-3 relayer txs per Intent (deploy once, buy batch, exit/redeem batch), so unverified supports about 30-40 Intents/day: **apply for Verified before any beta**. A Relayer API key (own wallet only) is unlimited but cannot be used for other users.
- Attach the builder code to every order; builders may charge fees (docs: all tiers).

### 2e. Geoblock for an operator server: GO with constraints

- `GET https://polymarket.com/api/geoblock` returns `{blocked, ip, country, region}` for the requesting IP. Fully blocked: IR, SY, CU, KP, UA-43/14/09. Close-only on frontend and API (no new positions): US, GB, FR, DE, IT, PL, SG, TW, TH, AU, BE, BR, RU, BY, CA (BC, ON, AB, QC) and others in the docs. Close-only on frontend only: IE, JP, MT (sports), NL, KR. India is not listed.
- Docs: orders from blocked regions are rejected; "builders should verify the location"; co-location is not available to builders. They do not say whether the server IP or the end user's location governs API orders.
- Rules for Paras: (1) run the Executor from a permitted region (e.g. IE or an unlisted country; eu-west-1 is cited as the closest non-restricted region); (2) gate **per user**, not per server: the eligibility matrix (#16) must use the full Polymarket list including frontend-only entries, and must not let a user from a close-only country open positions through a permitted server IP (that would circumvent Polymarket's restriction); (3) US users stay at redirects; (4) re-check the geoblock endpoint from the Executor host in health checks and fail closed.

### 3. Polymarket ToS on third-party operators: UNRESOLVED (HITL)

- `polymarket.com/tos` renders client-side. The body text was not retrievable (WebFetch and curl returned only page chrome; the web archive is blocked), so **no clause is quoted here and none is assumed**.
- Supporting evidence from the Builder docs (`developers/builders/builder-intro`): a builder is "a person, group, or organization that routes orders from users to Polymarket", and builders may create accounts for users and execute gasless transactions. The docs do not address custody, KYC or compliance responsibility, and no public builder agreement was found. Routing for users is clearly contemplated; per-user segregated, user-signed Intents fit it. An Executor holding a signer for many users' wallets is the part most likely to need explicit approval.
- Action: counsel reads the Terms of Use and Builder terms; email builder@polymarket.com (also for Verified tier and session-key access) describing the Vault flow. This blocks mainnet (#24), not testnet work.

### What needs live funds or Polymarket access (follow-up HITL)

1. Real CCTP burn-to-mint latency Monad to Polygon and back (needs USDC and gas).
2. Deploy a real Deposit Wallet via the relayer (needs a Builder API key) and place a real POLY_1271 order from the owner key and from a session key. This settles #77 and whether the relayer accepts session-signed non-CLOB batches.
3. Whether the CLOB accepts a contract (ERC-1271) wallet owner (option A).
4. Polymarket staging availability (SDK examples default to chain 80002 and `localhost:8080`; no public staging host confirmed).
5. ToS and builder-agreement legal read; Verified builder application.

### Downstream changes

- **#18 (Vault):** `settle` consumes the CCTP message and credits the user mapped from the burn's `messageSender`; return-burn `destinationCaller = Vault`; outbound `destinationCaller = 0`. The dispatch invariant is unchanged (`mintRecipient == registered Deposit Wallet`). Fork tests can use Monad USDC with `deal` (verified).
- **#19 (Deposit Wallets):** built as option B (see decision log); the scoped-session-key AC is reworded per 2b; provisioning via the relayer needs a Builder API key; add the negative test at the Executor policy layer, and keep a fork test documenting what a session key can do on-chain (see `spikes/17/test/DepositWalletFork.t.sol`).
- **#20 (Executor):** add the native USDC to USDC.e swap before wrap; all wallet actions go through relayer batches (rate limited); geoblock health check.

## Deployments

_Contract addresses, by network. Filled by #18 and later._

## Decision log

- 2026-10-09: V1 Vault is Polymarket-only, with per-user segregation and no pooled shares. Kalshi is read-only plus redirect. US and non-US users are both in scope, with the Vault gated by jurisdiction. Free native adapters for the main Venues; long tail through PolyRouter. MCP is read-only.
- 2026-10-09: Backend first, frontend last (after the user supplies brand assets). No Redis in V1; Postgres + pg-boss instead. REST `/v1` with OpenAPI generated from zod is the single contract for MCP and web. Only `apps/executor` holds keys. CI is required for merge by convention; GitHub branch protection is intentionally off.
- 2026-10-09 (#2): Routes are contract-first. Each is declared once in `packages/shared` (zod); the api implements it, and the OpenAPI 3.1 doc (zod-to-openapi) and typed client derive from it, with no codegen step. Internal packages export TS source; apps bundle with tsup. Vitest everywhere. API tests clone a migrated Postgres template DB per test file (DATABASE_URL in CI, testcontainers locally). Pinned: TypeScript 5.9, Vitest 3, ESLint 9, zod 4, Fastify 5, pg-boss 11, Foundry solc 0.8.28.
- 2026-10-09 (#10): Identity. SIWE (EIP-4361, EOA signatures via viem; EIP-1271 contract wallets deferred) on Monad chain ids 143/10143, plus passwordless email OTP (6 digits, HMAC-hashed, 10 min TTL, 5 attempts, 3 codes/email/10 min and 20/IP/hour). Sessions are opaque random tokens stored as sha256, 30 day TTL, sent as httpOnly SameSite=Lax cookie (default) or bearer token (`session: "bearer"`). Linking: signing in with a second identity while signed in attaches it; if that identity already belongs to another User the two Users merge, the older survives, all wallets/emails/sessions move, and the absorbed row stays as a tombstone (`users.merged_into_id`). Tables owned by a User must be repointed in `mergeUsers`. `returnTo` is sanitized (relative paths only) and stored server-side with the nonce/code.
- 2026-10-09 (#17): Risk spike done (see Vault risk findings). CCTP v2 Monad to Polygon is GO (domains 15/7, zero fee). CCTP mints native USDC but Polymarket's Onramp has native wrap paused, so the Route adds a native USDC to USDC.e swap before wrapping. Vault `settle` consumes the attested CCTP message rather than trusting Executor input. Polymarket session keys are not scoped on-chain; the Polygon-side Executor trust model needs a user decision (HITL), non-negotiables unchanged until then.
- 2026-10-09 (#3): `VenueAdapter` + normalized schema defined (see Venue adapters). Prices/amounts are decimal strings end to end (zod `DecimalString`; bigint-scaled math in `packages/domain`; Postgres `numeric`). Quotes derive from order books via `bookToQuote`. Each Market seeds its own single-Venue Event (`events` + `event_markets`). V1 Quote ingestion is polling: pg-boss `venue.sync-markets` every 10 min, `venue.poll-quotes` every minute (top 200 open Markets by volume, batched CLOB `/books`); WebSocket is a follow-up. `latest_quotes` is the hot read; `quote_snapshots` is appended when a Quote changes or every 5 min. The SSE stream (`/v1/events/{id}/stream`) re-reads `latest_quotes` every 2 s, so no cross-process pub/sub is needed. Quotes older than 2 min are flagged `stale`.
- 2026-10-09 (#13): Magic Links are compact HS256 JWS tokens (`kid` header, keys from `MAGIC_LINK_KEYS`, rotation = add key + switch `MAGIC_LINK_ACTIVE_KID`). Claims: jti, eventId, optional Outcome label/amount/maxPrice (decimal strings), source (claude/codex/web), optional bound userId, iat/exp (default TTL 1 h, max 24 h). Shareable URL is `WEB_BASE_URL/magic/<token>`; that path is the auth `returnTo`. `POST /v1/magic-links` creates (audit row in `magic_links`, token not stored); `GET /v1/magic-links/{token}` verifies and returns the prefill only. User-bound links need that User signed in (401 signed out, 403 other User). Fastify `maxParamLength` raised to 2048 for tokens in paths.
- 2026-10-09 (#19, #36): Polygon-side Executor trust model is **option B now, A later**. Deposit Wallet is the stock Polymarket wallet (owner = user's EOA), deployed via the builder relayer; the Executor holds a stock session key (fixed 180-day expiry, granted/rotated by owner-signed batches: rotation = `revokeSessionSigner(old)` + `authorizeSessionSigner(new)` in one batch, due within 30 days of expiry). The Executor signs only batches passing a deny-by-default policy: approve (fixed spenders), Onramp wrap / Offramp unwrap and swaps (native USDC <-> USDC.e, recipient = the wallet, slippage floor 1%), CTF redeem and exchange approvals, CCTP burn to domain 15 with `mintRecipient = destinationCaller = Vault`, plus CLOB order/cancel with maker = the wallet. No token transfers, no native value, no self-calls, per-Intent funding caps, sweep-back after fills. Keys are AES-256-GCM encrypted at rest with `EXECUTOR_MASTER_KEY` (testnet); mainnet requires the KMS backend (stubbed, launch gate). **Non-negotiable wording caveat:** on Polygon in V1 the Executor scope is enforced off-chain (policy layer) and by Polymarket's relayer; on Monad it is on-chain. Follow-up: migrate to per-user PolicyOwner (option A) once #35 confirms CLOB/relayer accept contract owners. Relayer wire format (`/submit` body, nonce and status endpoints) is unverified against the live relayer until #35. Fork-verified: `revokeSessionSigner` exists and works on the real wallet.
- 2026-10-09 (#4): Kalshi adapter (free public API v2, read-only, `routable: false`, `cftc_regulated`, no restricted jurisdictions). Outcome ids are `<ticker>:yes|no`; books are derived from the YES/NO bid ladders. Kalshi has no volume sort, so Markets are ordered within each synced page only. Volume is contracts (US$1 notional). Fee modeled as the `curve` 0.07 taker fee. The Event API `MarketView` gains a venue-agnostic `redirectUrl`: the exact Market page on the Venue's site for "Bet on <Venue>" (currently equal to `url`). Kalshi site URL shape `kalshi.com/markets/<series>/<slug>/<event>` is from public convention and could not be verified automatically (site rate-limits bots); the slug is cosmetic.
