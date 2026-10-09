# Blockers — how to unblock the build

Status 2026-10-09: all backend issues an agent can finish alone are merged (`main` green). Everything left needs a human. Work top to bottom; each item says what to provide, where, and what it unblocks.

## 1. Decisions (answer in chat or on the issue)

| #   | Decision                                                                                                                           | Recommendation                                                                                              | Unblocks                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D1  | Exits are a signed-in API request, not a wallet-signed `Exit` (PRD decision log, #21). OK, or require an EIP-712 `Exit` signature? | Require the signature (matches "user-signed Intent"; small change)                                          | Closing the #21 open question (#82)                                                      |
| D2  | Hosting provider (must run Docker; free/cheap) + a CDN in front of api and mcp (Cloudflare recommended)                            | Any Docker host + Cloudflare. The CDN must overwrite `CF-IPCountry`, or country checks (#16) can be spoofed | Public MCP URL for Claude/Codex (`docs/mcp.md`), real geo gating, OAuth issuer URL (#83) |

## 2. Accounts, keys and funds

| #   | What                                                                       | How to get it                                                 | Where it goes                                                                                      | Unblocks                                                                                                                                                                                | Issue          |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| K1  | Polymarket builder credentials + Verified builder tier                     | Apply via builder@polymarket.com / Polymarket builder program | `POLYMARKET_BUILDER_CODE`, relayer builder key env (see `apps/executor` README/PRD)                | Live Deposit Wallet deploy, CLOB orders, relayer > 100 tx/day                                                                                                                           | #35            |
| K2  | Small funded test wallet (native USDC on Monad + some MON and POL for gas) | Any wallet; ~$20 USDC is enough                               | Executor/test env per #35                                                                          | Live end-to-end: CCTP latency, real order, sell, redeem; confirms 5 open assumptions (relayer tx hash, session-signer API key, 6492 wrapping, exchange choice, duplicate-order wording) | #35 → then #46 |
| K3  | Funded Monad testnet deployer key + multisig/timelock addresses            | Monad testnet faucet; a Safe for the multisig                 | `forge script contracts/script/DeployVault.s.sol` (see #56); record addresses in PRD → Deployments | Real Vault on testnet; balance API against real deposits                                                                                                                                | #56            |
| K4  | Email provider key (Resend free tier) + sender domain                      | resend.com                                                    | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`                                            | Real email OTP sign-in, alerts and weekly digest (dev uses console), #84                                                                                                                | —              |
| K5  | Venue API keys                                                             | See "Venue API keys" below                                    | env vars below                                                                                     | Predict.fun, ProphetX, higher Myriad limits                                                                                                                                             | #61–#63        |

Production secrets you must set at deploy (no external signup): `AUTH_SECRET` (≥32 chars), `MAGIC_LINK_KEYS` + `MAGIC_LINK_ACTIVE_KID`, `EXECUTOR_MASTER_KEY` (testnet only; mainnet needs KMS), `ADMIN_EMAILS` / `ADMIN_WALLETS`, `OAUTH_ISSUER`, `MCP_URL`, `WEB_BASE_URL`. See `.env.example` and PRD.

## 3. Brand assets (frontend is blocked on this)

Provide logo (SVG), favicon, banner/OG images, color palette, fonts, any style references — attach to #25 or commit under `assets/brand/`. Unblocks #26 → #27–#31 (all frontend).

## 4. Manual checks (a person, ~1h total)

| What                                                                                           | Why                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Open a few Kalshi "Bet on Kalshi" links from `GET /v1/events`                                  | Kalshi blocks bots; URL shape unverified (#4)         |
| Open deep links for Polymarket US, Probable, Predict.fun, Novig, ProphetX, SX Bet              | Patterns are best guesses (#7, #52)                   |
| Confirm regulation labels (Novig, ProphetX = `unknown`; Myriad/Opinion/Predict.fun = offshore) | Legal accuracy of labels shown to users (#8, #52)     |
| Read each Venue's ToS on redistributing prices                                                 | Paras republishes quotes; none of the docs address it |

## 5. Launch gate (before mainnet Vault)

CFTC/securities counsel review, Polymarket ToS confirmation for third-party operators, smart-contract audit, KMS signer for the Executor → #24.

## Dependency map of what's left

- #35 (K1+K2) → #46 (Executor scope option A) and live Executor enablement (`EXECUTOR_INTENTS_ENABLED`)
- #56 (K3) → real Vault balance/history
- #25 (assets) → #26 → #27, #28, #29, #30, #31
- #21 + #23 + #30 + legal/audit → #24 mainnet

## Venue API keys

Key-gated long-tail adapters are off while their env var is unset and never affect core sync (see `packages/adapters/README.md`).

| Venue             | Env var                                                | How to obtain                                                                       | What it unblocks                                                                        | Issue |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----- |
| Predict.fun       | `PREDICTFUN_API_KEY` (+ optional `PREDICTFUN_API_URL`) | Discord support ticket; docs at dev.predict.fun                                     | Predict.fun Markets, quotes, history on mainnet (testnet is keyless)                    | #61   |
| ProphetX          | `PROPHETX_API_KEY` (+ optional `PROPHETX_API_URL`)     | Email the ProphetX Market Data team (see docs.prophetx.co, "Requesting API Access") | ProphetX sports Markets and ask quotes; also lets us re-record fixtures against sandbox | #62   |
| Myriad (optional) | `MYRIAD_API_KEY`                                       | Myriad builders channel (docs.myriad.markets)                                       | Higher rate limit only (30 req/10 s -> 200 req/s); adapter works without it             | #63   |

Keyless (no action): Polymarket US, Opinion, Probable, Novig.
