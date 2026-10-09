# Lessons

Patterns learned from corrections. Read at session start. Add an entry after any correction.

<!-- Format: - **<rule>** — why / when it applies -->
- **Re-run CI if main moved before merging** — two merges (#18, #74) skipped this; #74 left main red. `git fetch && git log HEAD..origin/main` must be empty when CI went green.
- **Every `pg.Pool` needs `pool.on('error')`** — idle-client errors (DB restart, `DROP DATABASE … WITH (FORCE)`) otherwise crash the process / fail tests as unhandled.
- **Tests must not pin wall-clock times relative to "now"** — `search.test.ts` set `createdAt` to a literal date; main went red once the clock passed it (#87). Use `Date.now() ± offset` or an injected `now`.
