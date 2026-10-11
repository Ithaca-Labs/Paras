# @paras/web

Next.js (App Router) frontend. **No business logic here**: it renders what the API returns. Foundation from #26; pages are #27 (Feed), #28 (Explore), #29 (Vault), #30 (Portfolio).

## Run

```
pnpm --filter @paras/api dev          # API on :3000
pnpm --filter @paras/web dev          # web on :3100 (webpack, see below)
```

Env (read from the repo-root `.env`, see `next.config.ts`): `API_URL` (default `http://localhost:3000`), `NEXT_PUBLIC_PRIVY_APP_ID` (falls back to `PRIVY_APP_ID`). Unset Privy id = sign-in button disabled, everything else works.

## Conventions

- **API access**: only the typed client from `@paras/shared`, via `src/lib/api.ts`.
  - Server components: `serverApi(cookie?)` (direct to `API_URL`; forward `(await cookies()).toString()` for per-User reads).
  - Client components: `api` (relative `/v1/*`, proxied by a `next.config.ts` rewrite, so the session cookie is same-origin and no CORS).
  - Fetch in server components by default; fetch in client components only for interaction. Never re-implement a rule the API owns.
- **Tokens, not colors**: all colors/fonts/radius are CSS variables in `src/app/globals.css` (neutral placeholder, light/dark via `prefers-color-scheme` or `data-theme`). Use the Tailwind utilities (`bg-surface`, `text-muted`, `border-border`, `bg-accent text-accent-fg`, `text-positive|negative|warning`, `rounded-card`). Never raw hex/palette classes. Brand assets (#25) change `globals.css` only.
- **Layout**: `AppShell` (root layout) provides header + nav + `<main>` (max-w-6xl). A page renders only its content, starting with `<PageHeader title>`. Don't add chrome. Add nav items in `components/nav.tsx`.
- **Routes**: one folder per route under `src/app/<route>/page.tsx` (no route groups). Set `export const metadata = { title }`. Pages reading Quotes: `export const dynamic = 'force-dynamic'` (cookie-reading pages are already dynamic).
- **Loading/error**: root `loading.tsx` / `error.tsx` / `not-found.tsx` already apply. Add per-route `loading.tsx` only when the skeleton differs. Reuse `CardSkeletons`, `ErrorState`, `EmptyState` from `components/states.tsx`.
- **Components**: `src/components/<kebab-name>.tsx`, server components unless they need state (`'use client'`). `EventCard` takes an `EventView` (+ optional `reason`). Display-only formatting lives in `lib/format.ts`.
- **Auth**: `useSession()` from `components/providers.tsx` gives `{ configured, loading, user, signIn, signOut }`. Privy (email/wallet/google, embedded wallet on Monad testnet 10143) is the sign-in. After login the Privy token is exchanged for an API session in `exchangePrivyToken` (`lib/session.ts`): **a stub until #92** (API endpoint not merged), so `user` stays null for Privy-only logins until then. Existing SIWE/email cookie sessions already show as signed in.
- **Webpack, not Turbopack**: `@paras/shared` imports `./x.js` for `x.ts`; Turbopack can't alias that. Scripts pass `--webpack`.
- **Tests**: Vitest + jsdom + Testing Library in `test/`. Test components through their rendered output.
