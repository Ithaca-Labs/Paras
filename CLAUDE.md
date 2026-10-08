# CLAUDE.md — Paras

Paras is a prediction market aggregator and discovery layer on Monad. It has four parts: cross-Venue price comparison, a personalized Feed built from onboarding, a read-only MCP connector for Claude and Codex with Magic Links, and a USDC Vault on Monad. The Vault routes bets to Polymarket in V1; Kalshi routing is the end goal.

## Read first (every session)

1. `PRD.md` is the source of truth for product, architecture, glossary, test seams and the issue map.
2. Read `tasks/lessons.md` for past mistakes. Do not repeat them.
3. Read the issue you're working on, including its comments, acceptance criteria and "Blocked by" list.
4. GitHub issues on `Ithaca-Labs/Paras`: #1 is the parent spec, and #2–#24 are slices (sub-issues of #1).

Use PRD glossary terms exactly in code, UI and docs: Venue, Market, Outcome, Event, Quote, Interest Profile, Feed, Magic Link, Vault, Deposit Wallet, Intent, Executor, Route.

## Architecture (details: PRD → System architecture)

- **Apps:**
  - `apps/api`: Fastify REST `/v1` plus SSE, auth, OAuth AS, Magic Links, admin
  - `apps/worker`: Venue sync, embeddings, matching, alerts
  - `apps/mcp`: thin read-only MCP layer over the API
  - `apps/executor`: the only signer; turns Vault Intents into Polymarket orders
  - `apps/web`: built last
- **Libraries:**
  - `packages/domain`: pure business logic, no I/O
  - `packages/adapters`
  - `packages/db`: Drizzle plus migrations
  - `packages/shared`: zod schemas, OpenAPI, typed client
  - `contracts`: Foundry
- **Infra:** Postgres+pgvector with pg-boss jobs. No Redis in V1.
- Domain rules go in `packages/domain`. Apps only wire I/O.

## Build order: backend first, frontend LAST

- Do **not** create or modify `apps/web` until you are working on a `frontend`-labeled issue.
- Frontend issues are blocked until the user provides brand assets (logo, banner, colors, fonts) in the `hitl` assets issue. Never invent a brand or design.
- Backend issues expose everything the UI needs as API endpoints. UI work belongs only in `frontend` issues.

## Non-negotiables (do not change without updating PRD decision log + user approval)

- The MCP server is read-only. It has no tool that moves money or places trades. Execution only happens on Paras with a user-signed Intent.
- The Vault keeps each user's funds segregated. No pooled shares or NAV.
- The Executor can only move a user's funds to that user's own Deposit Wallet, or back to that user, and only against a valid, unexpired, user-signed Intent.
- The user chooses the Event, Outcome and amount. The Vault only chooses the Venue. No autonomous strategies.
- Kalshi is read-only plus a redirect. V1 routes to Polymarket only. Keep the Route interface venue-agnostic.
- Vault execution is gated by jurisdiction (eligibility matrix). US users get discovery plus redirects.
- Data sources must be free. Use native adapters for Polymarket, Kalshi, Limitless and SX Bet. Long-tail Venues go through the feature-flagged PolyRouter adapter. Paid vendors must never be on the critical path.
- The MCP server and web app hold no business logic. It lives in the API and domain modules.

## Git workflow (mandatory)

- **Never commit directly to `main`.** Every change goes through a branch and a PR.
- **Work one issue per branch.** Before starting, confirm every issue in the "Blocked by" list is closed. If one isn't, pick another issue.
- **Start the issue:** assign yourself or comment "Starting" on the issue. Branch from up-to-date `main`:
  ```
  git checkout main && git pull
  git checkout -b <type>/<issue#>-<short-slug>   # e.g. feat/3-polymarket-adapter, fix/12-feed-order, chore/2-ci
  ```
  Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `spike`.
- **Commit small and often.** Use a concise message with the issue ref, e.g. `feat(adapter): polymarket quotes (#3)`. Push regularly with `git push -u origin <branch>`.
- **Open a PR early** (draft is fine) against `main`, using `.github/pull_request_template.md`. The PR body must:
  - include `Closes #<issue>` (or `Part of #<issue>` if the PR covers only part of it)
  - reference the parent `#1`
  - list related or blocking issues
  - copy the acceptance criteria from the issue as a checklist
  - include test evidence (commands run plus results)
- **Merge to `main` only when all of these hold:**
  1. CI is green (lint, typecheck, all tests, Foundry). Run `gh pr checks <pr> --watch` and confirm both the `node` and `contracts` jobs pass. GitHub doesn't enforce this; you must.
  2. You ran the full test suite locally and it passed.
  3. Every acceptance criterion is checked and verified, with the feature demonstrated working (e.g. API call or UI screenshot noted in the PR).
  4. `PRD.md` is updated in the same PR if any decision, address or finding changed.

  Then squash-merge, delete the branch, and confirm the issue closed. If it didn't, close it with a link to the PR.
- **Never merge with failing or skipped tests.** Never `--no-verify`. Never force-push `main`.
- **New scope found mid-issue?** Open a new issue linked to #1, label it `ready-for-agent` (or `hitl` if a human is needed), and reference it in the PR. Don't expand the current PR.
- **Blocked on a human decision?** Comment on the issue, add the `hitl` label, and stop that issue.

## Testing (see PRD "Testing Decisions")

Test external behavior at these seams only, never internals:
1. **Backend HTTP API.** Real Postgres in a container, with fixture-backed fake Venue adapters. Adapters also get fixture-replay normalization tests.
2. **MCP tools.** Tested through a real MCP client against the fixture-backed API.
3. **Vault contracts.** Foundry tests through external functions, plus fuzz/invariant tests and Monad fork tests for CCTP.
4. **Executor.** Full Intent lifecycle on a Polygon fork plus Polymarket staging, with a mocked CCTP attestation.

CI never makes live Venue calls. Record fixtures with the fixture harness. Every PR that changes behavior adds or updates tests at one of these seams.

## Labels

- `ready-for-agent`: fully specified; an agent can pick it up.
- `hitl`: needs a human action or decision.
- `frontend`: web UI work. Build it last, and only after the brand assets issue is closed.

## Session memory

- Durable decisions go in the `PRD.md` decision log.
- Contract addresses go in `PRD.md` → Deployments.
- Spike results go in `PRD.md` → Vault risk findings.
- After any user correction, add the pattern to `tasks/lessons.md`.
- Keep plans for the current task in `tasks/todo.md`, with checkable items and a review section at the end.

## Style

- Be concise in comments, PRs and commits.
- TypeScript strict mode. Match the surrounding code's idioms.
- Keep changes minimal and focused on the issue.
- End commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
