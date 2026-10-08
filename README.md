# Paras

Prediction market aggregator and discovery layer on Monad. Product spec: [`PRD.md`](PRD.md). Agent workflow: [`CLAUDE.md`](CLAUDE.md).

## Setup

Requires Node 22, pnpm 10 (`corepack enable`), Docker, and [Foundry](https://getfoundry.sh) for `contracts/`.

```sh
git clone --recurse-submodules <repo>   # or: git submodule update --init
pnpm install
cp .env.example .env
docker compose up --build               # postgres + migrations + api, worker, mcp, executor
curl localhost:3000/v1/health
```

Develop a single app against the compose Postgres: `docker compose up -d postgres`, `pnpm db:migrate`, then `pnpm --filter @paras/api dev` (needs `DATABASE_URL`, see `.env.example`).

## Scripts

| Command                                     | What                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| `pnpm lint`                                 | ESLint (flat config) + Prettier check                          |
| `pnpm typecheck`                            | `tsc` in every package (strict)                                |
| `pnpm test`                                 | Vitest in every package (starts Postgres via Docker if needed) |
| `pnpm build`                                | Bundle each app to `dist/` (tsup)                              |
| `pnpm format`                               | Prettier write                                                 |
| `pnpm db:generate` / `pnpm db:migrate`      | Drizzle migrations                                             |
| `cd contracts && forge build && forge test` | Solidity                                                       |

## Layout

| Path                | Role                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `apps/api`          | Fastify REST `/v1`, OpenAPI at `/v1/openapi.json`                    |
| `apps/worker`       | pg-boss consumer (Venue sync, matching, alerts), `/health`           |
| `apps/mcp`          | Read-only MCP server (Streamable HTTP at `/mcp`), `/health`          |
| `apps/executor`     | Only signer, `/health`                                               |
| `packages/domain`   | Pure business logic, no I/O                                          |
| `packages/adapters` | Venue adapters                                                       |
| `packages/db`       | Drizzle schema + migrations                                          |
| `packages/shared`   | zod schemas, route definitions, OpenAPI generation, typed API client |
| `packages/testkit`  | Fixture record/replay + Postgres test database helpers               |
| `contracts`         | Foundry (forge-std as git submodule)                                 |

Internal packages export TypeScript source (no build step); apps are bundled with tsup, which inlines `@paras/*`. Third-party deps used by any inlined package must be installed in the image (the Dockerfiles hoist them on deploy).

## Conventions

**Add an API route.** Declare it in `packages/shared/src/routes/<name>.ts` with `defineRoute` (zod params/query/body/response) and add it to `apiRoutes` in `routes/index.ts`. Implement it in `apps/api/src/routes/<name>.ts` with `implement(app, apiRoutes.x, handler)` and append the plugin to `routePlugins`. Validation, response parsing, the OpenAPI doc and the typed client (`createApiClient`) all derive from the one definition. Import `z` from `@paras/shared`.

**Add a migration.** Edit `packages/db/src/schema/*` (re-export from `schema/index.ts`), run `pnpm db:generate`, commit the SQL in `packages/db/drizzle`. For raw SQL: `pnpm --filter @paras/db exec drizzle-kit generate --custom --name=<name>`. Apply with `pnpm db:migrate`; tests apply them automatically.

**Test the API (seam 1).** Use the harness in `apps/api/test/harness.ts`:

```ts
const t = await createTestApp({ adapters: [fakeVenue] }); // beforeAll; fresh migrated DB per test file
await t.client.getHealth(); // typed client, in-process
await t.app.inject({ method: 'GET', url: '/v1/health' });
await t.close(); // afterAll
```

Other packages reuse it via `@paras/api/testing`. Suites needing Postgres set `globalSetup: ['@paras/testkit/global-setup']` in `vitest.config.ts` and call `createTestDatabase()` from `@paras/testkit`. With `DATABASE_URL` set (CI) that server is used; otherwise a `pgvector/pgvector:pg16` container is started via testcontainers. Migrations run once into a template database; every test file gets its own clone.

**Fixture tests (Venue adapters).** Adapters take an injectable `fetch`. In tests pass `createFixtureFetch({ dir: new URL('./fixtures/<venue>/', import.meta.url) })` from `@paras/testkit`. It replays JSON files and throws on a missing fixture; it never touches the network. To record: `RECORD_FIXTURES=1 pnpm --filter <pkg> test`, review the written files in `test/fixtures/`, commit them. Recording is refused when `CI` is set. Only content-type is stored from response headers.

**Require sign-in (auth guard).** `implement(app, apiRoutes.x, (req, ctx) => ..., { auth: 'required' })` answers 401 `unauthorized` for signed-out callers and passes `ctx.auth.userId` (also `sessionId`, `token`). `{ auth: 'optional' }` gives `ctx.auth: AuthContext | null`. Outside `implement` (e.g. SSE) use `await app.requireUser(req)` / `await app.authenticate(req)`. Callers authenticate with `Authorization: Bearer <token>` or the httpOnly `paras_session` cookie. Tests: sign in via `/v1/auth/email/request` + `t.mailer.lastCode(email)` + `/v1/auth/email/verify` (see `apps/api/test/auth.test.ts`). `returnTo` (relative paths only) is stored when a flow starts and echoed by verify, so Magic Links can resume after sign-in. When adding a table owned by a User, repoint it in `mergeUsers` (`apps/api/src/auth/users.ts`).

**Magic Links.** `POST /v1/magic-links` (auth optional; `bindToUser` needs sign-in) mints a signed HS256 JWS (`kid` header; claims in `packages/domain/src/magic-link.ts`) and returns `{ token, url, returnTo, expiresAt }`; `url` = `WEB_BASE_URL` + `/magic/<token>`. `GET /v1/magic-links/{token}` verifies and returns the prefill (Event, Outcome label, amount, maxPrice); it never executes anything. Errors: 400 `invalid_magic_link`, 410 `magic_link_expired`, 404 unknown Event, 401/403 for user-bound links. Pass `returnTo` (`/magic/<token>`) to auth flows so sign-in lands back on the prefill. Keys: `MAGIC_LINK_KEYS=kid:secret,...` (rotate by adding a key and switching `MAGIC_LINK_ACTIVE_KID`; drop old keys after the max TTL). Every issue/resolve is audited in `magic_links`.

**Add a Venue adapter.** See [`packages/adapters/README.md`](packages/adapters/README.md).

**Add an SSE route.** Declare with `defineSseRoute` (listed in `sseRoutes`, documented in OpenAPI as `text/event-stream`, not in the JSON client); implement with `implementSse` from `apps/api/src/implement.ts`. Throw `HttpError`/`notFound` from the handler to return the shared error shape before the stream opens.

**Add a job.** One file in `apps/worker/src/jobs/` using `defineJob` (name, zod payload, handler), registered in `buildJobs` in `jobs/index.ts`. Jobs needing the DB or adapters are factories taking `VenueJobContext` (see `venue-sync.ts`). Recurring jobs: add to `buildSchedules`.

**Add an MCP tool.** In `apps/mcp/src/server.ts`; thin wrapper over the typed client. Read-only, always.

## CI

`.github/workflows/ci.yml`: `node` job (install, lint, typecheck, test against a pgvector service, build) and `contracts` job (`forge build`, `forge test`, submodules checked out). Merge only when both are green.
