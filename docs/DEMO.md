# Hackathon demo runbook (Monad testnet, chain 10143)

Checklist to go from clean checkout to a working demo, then a 3-minute script. Secrets live only in the repo-root `.env` (gitignored). Never paste them anywhere.

## 0. Prerequisites

Node 22, pnpm 10, Docker, Foundry. `pnpm install`, `cp .env.example .env`, `git submodule update --init`.

## 1. Privy dashboard (dashboard.privy.io)

- [ ] App created; `PRIVY_APP_ID`, `PRIVY_APP_SECRET` into `.env`.
- [ ] Embedded wallets: enabled, create on login for all users (EVM). Add **Monad testnet (10143)** as a chain; if the app rejects it, add it as a custom chain (RPC `https://testnet-rpc.monad.xyz`).
- [ ] Login methods: email, wallet, Google.
- [ ] **Identity tokens: on** (web exchanges access + identity token at `POST /v1/auth/privy`).
- [ ] Allowed origins: `http://localhost:3100` (and the deployed web origin).
- [ ] Authorization key: create one (Wallets > Authorization keys). Private key -> `PRIVY_AUTHORIZATION_PRIVATE_KEY` (base64 PKCS8 P-256). The key quorum id -> `PRIVY_SIGNER_ID`.

## 2. Deploy the Vault (human step: keystore password is interactive)

From `contracts/`. `EXECUTOR` is the address of `EXECUTOR_PRIVATE_KEY`; it is also the DemoCctp attester. `TIMELOCK_DELAY=60` (seconds) keeps the optional Privy role grant in step 4 quick; the script default is 1 h.

```sh
cd contracts
DEMO_CCTP=true TIMELOCK_DELAY=60 \
EXECUTOR=0x7B093Dd62A916a3B425817A12466468d04312a74 \
forge script script/DeployVault.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account chainlink --sender 0xAc99290B7Cd053276839Fb4bfB33dA9cdABF727D \
  --broadcast
```

Deployer needs MON from the Monad faucet (https://faucet.monad.xyz).

- [ ] Read addresses and block from `contracts/broadcast/DeployVault.s.sol/10143/run-latest.json`: `transactions[]` entries by `contractName` (`DemoCctp`, `TimelockController`, `Vault` = impl, `ERC1967Proxy` = **Vault proxy**), and `receipts[0].blockNumber` (or the first receipt's block) = deploy block.
  ```sh
  jq -r '.transactions[] | "\(.contractName) \(.contractAddress)"' contracts/broadcast/DeployVault.s.sol/10143/run-latest.json
  jq -r '.receipts[0].blockNumber' contracts/broadcast/DeployVault.s.sol/10143/run-latest.json | xargs printf '%d\n'
  ```
- [ ] Record the four addresses in `PRD.md` > Deployments.

## 3. `.env` (repo root, read by every app and by `apps/web`)

```sh
# core
DATABASE_URL=postgres://paras:paras@localhost:5432/paras
AUTH_SECRET=<>=32 chars>
MAGIC_LINK_KEYS=k1:<>=32 chars>
MAGIC_LINK_ACTIVE_KID=k1
WEB_BASE_URL=http://localhost:3100
OAUTH_ISSUER=http://localhost:3000        # public API origin (Claude connector needs a public URL, see 7)
OAUTH_CONSENT_URL=http://localhost:3100/oauth/consent   # web consent screen; unset = plain fallback page
MCP_URL=http://localhost:3002             # public MCP origin
API_URL=http://localhost:3000             # web + mcp -> api. Web bakes this in at build time (rewrite)

# Vault (api + executor)
VAULT_ADDRESS=<Vault proxy>
VAULT_CHAIN_ID=10143
USDC_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3   # default; Monad testnet USDC
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
EXECUTOR_DEMO_MODE=simulate               # api + executor: shows the "Polymarket leg simulated" banner

# Executor (apps/executor)
EXECUTOR_NETWORK=testnet
EXECUTOR_INTENTS_ENABLED=true
EXECUTOR_PRIVATE_KEY=<key of 0x7B09...a74>
EXECUTOR_MASTER_KEY=<32 bytes hex>        # openssl rand -hex 32
MONAD_MESSAGE_TRANSMITTER=<DemoCctp>
VAULT_START_BLOCK=<deploy block>
# EXECUTOR_MONAD_SIGNER=privy + PRIVY_EXECUTOR_WALLET_ID: optional, step 4

# Privy (api; app id also web)
PRIVY_APP_ID= PRIVY_APP_SECRET= PRIVY_AUTHORIZATION_PRIVATE_KEY= PRIVY_SIGNER_ID=
NEXT_PUBLIC_PRIVY_APP_ID=                 # optional, falls back to PRIVY_APP_ID

# Nansen (worker). Unset = smart-money off. Free tier is ~10 credits/day
NANSEN_API_KEY=
NANSEN_DAILY_CAP=8
NANSEN_TTL_HOURS=24

# Envio (step 5)
ENVIO_API_TOKEN= ENVIO_VAULT_ADDRESS=<Vault proxy> ENVIO_START_BLOCK=<deploy block>
ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql    # api

# Aurora / NEAR Intents: keep unset on testnet. The feature only turns on when VAULT_CHAIN_ID=143
# NEAR_INTENTS_API_KEY=

# Demo-only (web, non-production only): pretend the visitor is in a routable country
DEV_COUNTRY=IN
```

Vault gate: with no CDN header the country is unknown and the API fails closed to redirect-only. `DEV_COUNTRY=IN` (any routable country; US is redirect-only) is stamped on every web request by `apps/web/src/proxy.ts`, server-rendered pages and the `/v1` proxy alike. It is ignored when `NODE_ENV=production`, so demo with `pnpm --filter @paras/web dev`, not `start`. In production the CDN must set `CF-IPCountry` / `X-Vercel-IP-Country`.

## 4. Executor wallet (Privy server wallet; optional but it is a Privy bounty item)

The default demo signs Vault txs with `EXECUTOR_PRIVATE_KEY` (already holds `EXECUTOR_ROLE`). To move that to a Privy server wallet under policy:

- [ ] `pnpm --filter @paras/executor exec tsx src/vault/provision-privy.ts` (needs `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `VAULT_ADDRESS`, `VAULT_CHAIN_ID`). It prints `PRIVY_EXECUTOR_WALLET_ID=...` and the wallet address. Add the id to `.env`, set `EXECUTOR_MONAD_SIGNER=privy`.
- [ ] Fund that address with MON.
- [ ] Grant `EXECUTOR_ROLE` through the Timelock (deployer EOA is proposer + executor). `W` = wallet address, `T` = Timelock, `V` = Vault proxy:
  ```sh
  Z=0x0000000000000000000000000000000000000000000000000000000000000000
  D=$(cast calldata "grantRole(bytes32,address)" $(cast keccak EXECUTOR_ROLE) $W)
  cast send $T "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" $V 0 $D $Z $Z 60 \
    --account chainlink --rpc-url https://testnet-rpc.monad.xyz
  sleep 65
  cast send $T "execute(address,uint256,bytes,bytes32,bytes32)" $V 0 $D $Z $Z \
    --account chainlink --rpc-url https://testnet-rpc.monad.xyz
  ```
  Keep `EXECUTOR_PRIVATE_KEY` set: it is still the DemoCctp attester and Polygon-side (simulated) signer.

## 5. Start everything

```sh
docker compose up -d postgres
pnpm db:migrate
docker compose --profile indexer up -d indexer-db hasura indexer   # Envio; Hasura on :8080
pnpm --filter @paras/api dev        # :3000
pnpm --filter @paras/worker dev     # :3001  Venue sync, Quotes, Nansen refresh
pnpm --filter @paras/executor dev   # :3003  logs "SIMULATED" in demo mode
pnpm --filter @paras/mcp dev        # :3002
pnpm --filter @paras/web dev        # :3100  (reads root .env; DEV_COUNTRY applies here)
```

The indexer service installs and runs codegen on first start (a few minutes). Let the worker run ~2 min so Events and Quotes exist.

Checks:

- [ ] `curl localhost:3000/v1/health`, `:3001/health`, `:3002/health`, `:3003/health` (executor reports demo label).
- [ ] `curl -s localhost:3100/v1/config` shows `features.anyChainDeposit: false` (correct on testnet).
- [ ] SSE through the web origin streams: `curl -sN localhost:3100/v1/events/<id>/stream` prints `: connected` then `event: quote` lines every ~2 s (verified unbuffered through the Next proxy, also with `accept-encoding: gzip`).
- [ ] Hasura console `localhost:8080` lists `VaultActivity` after the first deposit.

## 6. Test user funds

- [ ] Sign in at `localhost:3100` with Privy (email). Copy the embedded wallet address.
- [ ] MON for gas: https://faucet.monad.xyz.
- [ ] Testnet USDC (`0x534b...43A3`): https://faucet.circle.com (select Monad Testnet). Also top up the DemoCctp contract with a few USDC (sells can book a profit).
- [ ] Do one warm-up deposit before the demo so Envio history is populated and the Deposit Wallet is registered.

## 7. Claude connector (MCP)

Claude needs a public HTTPS URL for the MCP and API issuer: tunnel both (`cloudflared tunnel --url http://localhost:3002`, same for 3000), set `MCP_URL` and `OAUTH_ISSUER` to the tunnel origins, restart api + mcp. Then Claude > Settings > Connectors > Add custom connector > `https://<mcp-tunnel>/mcp`; connect (the Paras consent screen opens via `OAUTH_CONSENT_URL`; the web origin must be reachable by the browser, localhost is fine). Details: `docs/mcp.md`.

## 8. 3-minute demo script

Story: Onchain Finance & Trading. "Paras finds the best price for a prediction-market bet across Venues, explains the move with smart money, and lets an agent (or you) trade from a segregated Monad Vault, without ever giving anyone custody."

| Time | Do                                                                                                                                                                                    | Say / bounty                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Open `/explore`, search "fed" or a trending topic, open an Event.                                                                                                                     | One screen, every Venue, fee-adjusted. Venue labels (regulated / offshore).                                                                                                           |
| 0:20 | Type a stake in Compare; point at the live Quote ticking (SSE). Show Kalshi as "Bet on Kalshi" (redirect) and Polymarket as "Bet with Vault".                                         | Cross-Venue price comparison. Kalshi is read-only plus redirect. The Vault button exists because `DEV_COUNTRY=IN`/the CDN country makes it routable; show US = redirect-only if time. |
| 0:40 | **Nansen**: point at the smart-money panel and the "Why is this moving?" summary (leans YES/NO, profitable holders).                                                                  | Nansen smart-money signals drive the Feed ranking, alerts and the Event page.                                                                                                         |
| 1:00 | **Claude + MCP**: in Claude, "Why is <event> moving? Compare Venues." Claude calls `search_events`, `explain_market` (Nansen data), `compare_prices`, returns a Magic Link. Click it. | Read-only MCP; no tool can move money. Magic Link opens Paras prefilled; the user signs on Paras.                                                                                     |
| 1:30 | **Privy beyond login**: signed in with the Privy embedded wallet (no extension). Settings > one-click trading > Grant (session signer, max per bet and cumulative cap).               | Embedded wallet is the Vault account. Delegation is a Privy session signer under a deny-by-default policy (only Vault Intents for this user, capped). Revocable in one click.         |
| 1:50 | Event page > Bet panel: place a **one-click bet** ($5). Open `/portfolio`: Intent timeline moves through submitted > dispatched > filled > settled.                                   | Executor is the only signer, scoped to this user's funds; banner says the Polymarket leg is simulated on testnet.                                                                     |
| 2:10 | Place a **limit order + TP/SL** on the same Event; open `/orders` to show it resting and conditional.                                                                                 | Privy delegation fires it later without the user online.                                                                                                                              |
| 2:30 | **Envio**: `/portfolio` Vault history (deposits/withdrawals/Intents) is served from Envio HyperIndex; flash Hasura `:8080` with `VaultActivity`.                                      | History is Envio-backed (`ENVIO_GRAPHQL_URL`), falling back to polling only if Envio is down.                                                                                         |
| 2:45 | **Aurora**: `/vault` "Deposit from any chain" is absent on testnet by design.                                                                                                         | Aurora / NEAR Intents 1Click any-chain deposit is mainnet-only (`VAULT_CHAIN_ID=143`); one flag turns it on. Funds land in the user's own wallet, then deposit.                       |
| 2:55 | Close on the Vault: segregated per-user balance, no pooled shares, Executor can only move funds to the user's own Deposit Wallet or back.                                             | Safety story.                                                                                                                                                                         |

### Fallbacks

- No Privy approval of Monad testnet: add it as a custom chain (step 1); the bet panel still works with a SIWE wallet, minus one-click.
- Nansen empty (credit cap hit): panel shows "no signal"; raise `NANSEN_DAILY_CAP` only if the key allows.
- Executor stuck: check its log; `DemoCctp` needs USDC escrow and the executor wallet MON.
- Vault button missing: country unknown. Confirm `DEV_COUNTRY` is set and web runs under `dev`, not `start`.
