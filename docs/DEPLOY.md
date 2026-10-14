# Deploy (testnet demo)

Web on Vercel, backend on Render (`render.yaml` Blueprint), DNS and edge on Cloudflare (#83). Domain: `paraspredic.fun`.

## 1. Cloudflare

Site added, nameservers moved from Hostinger. SSL/TLS mode: **Full**.

## 2. Render

1. New → **Blueprint** → this repo. Creates `paras-db` (Postgres 16), `paras-api`, `paras-mcp` (web), `paras-worker` (worker), `paras-executor` (private). Fill the `sync: false` prompts from your local `.env`; `MAGIC_LINK_KEYS` = `k1:<openssl rand -hex 32>`.
2. Migrate from your laptop (prod images have no migrations): `DATABASE_URL=<paras-db External URL> pnpm db:migrate`. Re-run after every schema change. `0000_enable_pgvector.sql` enables pgvector.
3. If `paras-api`'s internal hostname (Connect → Internal) is not `paras-api`, fix `API_URL` on `paras-mcp`.

`EMAIL_PROVIDER=console`: email sign-in codes only go to the api log. For real email set `resend`, `RESEND_API_KEY`, `EMAIL_FROM` and add Resend's DNS records.

## 3. Cloudflare DNS

- `api`, `mcp`: CNAME → `paras-api.onrender.com` / `paras-mcp.onrender.com`, **proxied**. Verify each domain in Render.
- `@`, `www`: Vercel records, **DNS only** (Vercel advice).

## 4. Vercel

Import the repo, root directory `apps/web`. Env: `API_URL=https://paras-api.onrender.com`, `NEXT_PUBLIC_PRIVY_APP_ID`. `API_URL` is baked in at build: redeploy after changing it. Add `paraspredic.fun` and `www`.

`API_URL` must be the Render origin, not `api.paraspredic.fun`: through Cloudflare the API would read Vercel's datacenter country, not the visitor's. Hardening: #136.

## 5. Privy

Add `https://paraspredic.fun` to allowed origins.

## Check

- `curl https://api.paraspredic.fun/v1/health` → `db: true`; `curl https://mcp.paraspredic.fun/health`.
- `curl https://api.paraspredic.fun/.well-known/oauth-authorization-server` → issuer `https://api.paraspredic.fun`.
- `https://paraspredic.fun`: Feed loads, sign in, Vault eligibility shows your country, demo deposit + bet completes.
- Claude → add connector `https://mcp.paraspredic.fun/mcp` → sign in → a tool call returns Markets.
