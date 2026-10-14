# Deploy (testnet demo)

Web on Vercel, backend on Railway, DNS and edge on Cloudflare (#83). `<domain>` = your domain.

## 1. Cloudflare

Add the site (free plan). At the registrar (Hostinger: Domains → Nameservers), switch to the two Cloudflare nameservers. SSL/TLS mode: **Full**.

## 2. Railway

1. New project → add the **pgvector** Postgres template.
2. Migrate from your laptop (prod images have no migrations): `DATABASE_URL=<Postgres public URL> pnpm db:migrate`. Re-run after every schema change.
3. Add one service per app from the GitHub repo. Root directory = repo root; config file = `apps/<app>/railway.json`.

| Service  | Port | Domain                                 | Env (plus `DATABASE_URL=${{Postgres.DATABASE_URL}}`)                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api      | 3000 | Railway domain + custom `api.<domain>` | `AUTH_SECRET`, `MAGIC_LINK_KEYS`, `MAGIC_LINK_ACTIVE_KID`, `AUTH_DOMAIN=<domain>`, `WEB_BASE_URL=https://<domain>`, `OAUTH_ISSUER=https://api.<domain>`, `OAUTH_CONSENT_URL=https://<domain>/oauth/consent`, email (`EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`), Privy, Vault (`VAULT_ADDRESS`, `VAULT_CHAIN_ID`, `MONAD_RPC_URL`), `EXECUTOR_DEMO_MODE=simulate`, `ADMIN_EMAILS`, `ENVIO_GRAPHQL_URL` (optional) |
| worker   | 3001 | none                                   | email, `NANSEN_API_KEY`                                                                                                                                                                                                                                                                                                                                                                                                 |
| mcp      | 3002 | custom `mcp.<domain>`                  | `API_URL=http://api.railway.internal:3000`, `MCP_URL=https://mcp.<domain>`, `OAUTH_ISSUER=https://api.<domain>`                                                                                                                                                                                                                                                                                                         |
| executor | 3003 | none                                   | Testnet demo vars from PRD → Deployments (`EXECUTOR_DEMO_MODE=simulate`, `EXECUTOR_PRIVATE_KEY`, `EXECUTOR_MASTER_KEY`, `VAULT_*`, `MONAD_*`, ...)                                                                                                                                                                                                                                                                      |

Values for Vault, Privy and the Executor match your working local `.env`. Secrets: `openssl rand -hex 32`.

If `api.railway.internal` refuses connections (IPv6-only private network), change the api listen host to `::`.

## 3. Cloudflare DNS

- `api`, `mcp`: CNAME → the Railway targets, **proxied**.
- `@`, `www`: Vercel records, **DNS only** (Vercel advice).
- Resend SPF/DKIM records if using email.

## 4. Vercel

Import the repo, root directory `apps/web`. Env: `API_URL=https://<api>.up.railway.app`, `NEXT_PUBLIC_PRIVY_APP_ID`. `API_URL` is baked in at build: redeploy after changing it. Add `<domain>`.

`API_URL` must be the Railway origin, not `api.<domain>`: through Cloudflare the API would read Vercel's datacenter country, not the visitor's. Hardening: #136.

## 5. Privy

Add `https://<domain>` to allowed origins.

## Check

- `curl https://api.<domain>/v1/health` → `db: true`; `curl https://mcp.<domain>/health`.
- `curl https://api.<domain>/.well-known/oauth-authorization-server` → issuer `https://api.<domain>`.
- `https://<domain>`: Feed loads, sign in, Vault eligibility shows your country, demo deposit + bet completes.
- Claude → add connector `https://mcp.<domain>/mcp` → sign in → a tool call returns Markets.
