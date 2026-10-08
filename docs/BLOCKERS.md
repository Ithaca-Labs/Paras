# Blockers

## Venue API keys

Key-gated long-tail adapters are off while their env var is unset and never affect core sync (see `packages/adapters/README.md`).

| Venue             | Env var                                                | How to obtain                                                                       | What it unblocks                                                                        | Issue |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----- |
| Predict.fun       | `PREDICTFUN_API_KEY` (+ optional `PREDICTFUN_API_URL`) | Discord support ticket; docs at dev.predict.fun                                     | Predict.fun Markets, quotes, history on mainnet (testnet is keyless)                    | #61   |
| ProphetX          | `PROPHETX_API_KEY` (+ optional `PROPHETX_API_URL`)     | Email the ProphetX Market Data team (see docs.prophetx.co, "Requesting API Access") | ProphetX sports Markets and ask quotes; also lets us re-record fixtures against sandbox | #62   |
| Myriad (optional) | `MYRIAD_API_KEY`                                       | Myriad builders channel (docs.myriad.markets)                                       | Higher rate limit only (30 req/10 s -> 200 req/s); adapter works without it             | #63   |

Keyless (no action): Polymarket US, Opinion, Probable, Novig.
