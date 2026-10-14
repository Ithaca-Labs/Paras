# Deploy (testnet demo)

Web on Vercel. Backend on one VPS (Oracle Cloud A1, Ubuntu 24.04 arm64) with Docker Compose. DNS and ingress on Cloudflare: a Cloudflare Tunnel (`paras`) is the only way in, so no ports are open and `CF-IPCountry` can't be spoofed (#83). Domain: `paraspredic.fun`.

## Server

`~/paras` on the VPS holds the source (no git; synced with rsync) and `.env` (mode 600, never committed). Keys: `.env.example`, plus `CLOUDFLARE_TUNNEL_TOKEN` (`cloudflared tunnel token paras`) and `DATABASE_URL=postgres://paras:paras@postgres:5432/paras`.

Deploy or update from the repo root on your machine:

```sh
rsync -az --delete --exclude node_modules --exclude .next --exclude .turbo --exclude dist \
  --exclude .git --exclude .env --exclude contracts --exclude spikes --exclude brand-assets --exclude .claude \
  ./ ubuntu@<vps>:~/paras/
ssh ubuntu@<vps> 'cd ~/paras && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build'
```

The `migrate` service runs migrations before the apps start. Postgres data lives in the `pgdata` volume.

## Cloudflare

- Tunnel `paras`; ingress in `deploy/cloudflared.yml`: `api.` → `api:3000`, `mcp.` → `mcp:3002`. DNS: `cloudflared tunnel route dns paras <host>`.
- `@`, `www`: Vercel records, **DNS only** (Vercel advice).

## Vercel

Import the repo, root directory `apps/web`. Env: `API_URL=https://api.paraspredic.fun`, `NEXT_PUBLIC_PRIVY_APP_ID`. `API_URL` is baked in at build: redeploy after changing it. Add `paraspredic.fun` and `www`.

Web → API passes through Cloudflare, which stamps Vercel's datacenter country; #136 makes the API trust the visitor country the web forwards.

## Privy

Add `https://paraspredic.fun` to allowed origins.

## Check

- `curl https://api.paraspredic.fun/v1/health` → `db: true`; `curl https://mcp.paraspredic.fun/health`.
- `curl https://api.paraspredic.fun/.well-known/oauth-authorization-server` → issuer `https://api.paraspredic.fun`.
- `https://paraspredic.fun`: Feed loads, sign in, Vault eligibility shows your country, demo deposit + bet completes.
- Claude → add connector `https://mcp.paraspredic.fun/mcp` → sign in → a tool call returns Markets.
- Logs: `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api`.
