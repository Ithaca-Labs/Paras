# Paras MCP server

Read-only MCP connector for Claude and Codex. It searches Events, compares prices across Venues and mints Magic Links. It cannot trade or move money: you open a Magic Link on Paras and sign yourself.

Endpoint: Streamable HTTP, stateless, `POST {MCP_URL}/mcp` (default port 3002). Public tools need no auth; OAuth and personal tools come with #15.

## Tools

| Tool | What it does |
|---|---|
| `search_events` | Hybrid text + semantic search with filters (`status`, `venue`, `category`, `topic`, `entity`, `closesAfter`, `closesBefore`, `minLiquidity`, `limit`, `cursor`) |
| `list_trending` | Trending open Events |
| `list_closing_soon` | Open Events resolving soonest |
| `get_event` | One Event, all Venue Markets and Outcome prices |
| `compare_prices` | Fee-adjusted cross-Venue comparison; optional `stake` (USD) for size-aware fills |
| `create_magic_link` | Link to an Event, optionally prefilled (`outcome`, `amount`, `maxPrice`) |

Every Event result includes `magicLink` and per-Venue `availability` (`routable`, `redirect`, `blocked`) for the caller's country. `source` (`claude` or `codex`) is recorded on the link.

The server forwards `cf-ipcountry` / `x-vercel-ip-country` from the MCP request to the API. Put it behind the same CDN as the API, or availability falls back to the fail-closed default.

## Claude (custom connector)

1. Claude > Settings > Connectors > Add custom connector.
2. Name: `Paras`. URL: `https://<mcp-host>/mcp`.
3. Add, then enable it in a chat (the `+` menu > Connectors).
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
