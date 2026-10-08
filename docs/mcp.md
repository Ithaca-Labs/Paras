# Paras MCP server

Read-only MCP connector for Claude and Codex. It searches Events, compares prices across Venues and mints Magic Links. It cannot trade or move money: you open a Magic Link on Paras and sign yourself.

Endpoint: Streamable HTTP, stateless, `POST {MCP_URL}/mcp` (default port 3002). Public tools need no auth. Personal tools (`get_my_feed`, `get_portfolio`) need OAuth; see [Auth](#auth).

## Tools

| Tool                | What it does                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_events`     | Hybrid text + semantic search with filters (`status`, `venue`, `category`, `topic`, `entity`, `closesAfter`, `closesBefore`, `minLiquidity`, `limit`, `cursor`) |
| `list_trending`     | Trending open Events                                                                                                                                            |
| `list_closing_soon` | Open Events resolving soonest                                                                                                                                   |
| `get_event`         | One Event, all Venue Markets and Outcome prices                                                                                                                 |
| `compare_prices`    | Fee-adjusted cross-Venue comparison; optional `stake` (USD) for size-aware fills                                                                                |
| `create_magic_link` | Link to an Event, optionally prefilled (`outcome`, `amount`, `maxPrice`)                                                                                        |

| `get_my_feed` | Your personalized Feed (same as the web Feed) with Magic Links. Scope `feed:read` |
| `get_portfolio` | Your Vault balances (idle, reserved, in-flight USDC). Scope `portfolio:read`. Empty state until the Vault is live |

Every Event result includes `magicLink` and per-Venue `availability` (`routable`, `redirect`, `blocked`) for the caller's country. `source` (`claude` or `codex`) is recorded on the link.

The server forwards `cf-ipcountry` / `x-vercel-ip-country` from the MCP request to the API. Put it behind the same CDN as the API, or availability falls back to the fail-closed default.

## Auth

OAuth 2.1 (authorization code + PKCE S256, public clients, dynamic client registration RFC 7591). `apps/mcp` is the resource server; `apps/api` is the authorization server.

- `GET {MCP_URL}/.well-known/oauth-protected-resource` (RFC 9728) points clients at the issuer.
- `GET {API}/.well-known/oauth-authorization-server` (RFC 8414); endpoints `/oauth/register`, `/oauth/authorize`, `/oauth/token`.
- Scopes: `markets:read` (always granted), `feed:read`, `portfolio:read`. There is no write or trade scope.
- Access tokens last 1 h; refresh tokens 30 days and rotate on use.
- Public tools work with no token. Calling a personal tool without one answers `401` + `WWW-Authenticate: Bearer resource_metadata=...`, which starts the client's OAuth flow; a token missing the scope answers `403 insufficient_scope`. A presented token that is expired or revoked answers `401 invalid_token` for every tool.
- Consent needs a Paras session. Until the web consent screen exists, `/oauth/authorize` serves a plain sign-in (email code) and Allow/Deny page. Set `OAUTH_CONSENT_URL` to redirect to the web screen instead; it should call `GET /v1/oauth/clients/{id}` and `POST /v1/oauth/authorize` (`approve: true|false`, returns `redirectUrl`).
- Connected apps: `GET /v1/connected-apps`, `DELETE /v1/connected-apps/{id}` (session only). Revoking deletes the grant and all its tokens; the next MCP request fails. One grant per (User, client): re-consenting replaces the old one.
- OAuth tokens only work on routes that opt in with a `scope` in `implement` (today `GET /v1/feed`, `GET /v1/vault/balance`, `GET /v1/oauth/token-info`). Everywhere else they are treated as signed out.

Config: API `OAUTH_ISSUER` (public API origin), `OAUTH_CONSENT_URL`; MCP `MCP_URL` (public origin), `OAUTH_ISSUER` (defaults to `API_URL`).

## Claude (custom connector)

1. Claude > Settings > Connectors > Add custom connector.
2. Name: `Paras`. URL: `https://<mcp-host>/mcp`.
3. Add, then connect (a Paras sign-in and consent page opens) and enable it in a chat (the `+` menu > Connectors).
4. Try: "What are the odds the Fed cuts in December? Compare Venues."

Claude Code: `claude mcp add --transport http paras https://<mcp-host>/mcp`.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.paras]
url = "https://<mcp-host>/mcp"
```

Or: `codex mcp add paras --url https://<mcp-host>/mcp`. Restart Codex; `/mcp` should list `paras`.

## Local

```
pnpm --filter @paras/api dev   # :3000
API_URL=http://localhost:3000 pnpm --filter @paras/mcp dev   # :3002
claude mcp add --transport http paras http://localhost:3002/mcp
```
