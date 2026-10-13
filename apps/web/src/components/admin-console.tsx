'use client';

import type { AdminMarket, MatchReview, VenueHealth } from '@paras/shared';
import Image from 'next/image';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ago, plainText, when } from '@/lib/format';
import { SubmitStatus, useSubmit } from '@/lib/use-submit';
import { EmptyState } from './states';

type Pause = { scope: string; reason: string; pausedAt: string };
export interface AdminData {
  health: { staleAfterSeconds: number; items: VenueHealth[] };
  pauses: { items: Pause[]; vaultPaused: boolean | null };
  reviews: MatchReview[];
}

/* Brand controls (same shapes as Explore and the Event page). */
const primary =
  'rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';
const ghost =
  'rounded-full border border-border px-4 py-1.5 text-sm font-medium text-fg hover:border-accent hover:text-accent disabled:opacity-50';
const danger =
  'rounded-full border border-seal/60 bg-seal/10 px-5 py-2 text-sm font-medium text-negative hover:bg-seal hover:text-parchment disabled:opacity-50';
const field =
  'pill-field h-10 w-full appearance-none rounded-full border border-border bg-bg/70 px-4 text-sm text-fg placeholder:text-muted/70 hover:border-fg/40 focus:border-accent focus:ring-4 focus:ring-accent/10 focus:outline-none';
const card = 'rounded-card border border-border bg-surface';
const eyebrow =
  'flex items-center gap-2 font-display text-[0.7rem] tracking-[0.22em] text-muted uppercase';

/** Times differ between server render and the browser (clock, timezone); render them client-side. */
function Time({ text, title }: { text: string; title?: string }) {
  return (
    <span suppressHydrationWarning title={title}>
      {text}
    </span>
  );
}
const Ago = ({ iso }: { iso: string | null }) => <Time text={ago(iso)} title={when(iso)} />;

function Seal() {
  return <span aria-hidden className="size-2 shrink-0 rounded-[2px] bg-seal" />;
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs text-muted">
      <span className="pl-4">{text}</span>
      {children}
    </label>
  );
}

/** Operator console (#31). Holds no rules: every action is an admin API call, then a re-read. */
export function AdminConsole({ initial }: { initial: AdminData }) {
  const [health, setHealth] = useState(initial.health);
  const [pauses, setPauses] = useState(initial.pauses);
  const [pending, setPending] = useState(initial.reviews.length);
  const global = pauses.items.find((p) => p.scope === 'global');
  const okCount = health.items.filter((v) => v.status === 'ok').length;

  return (
    <div className="grid gap-12">
      {global && (
        <p
          role="alert"
          className="rise flex items-center gap-3 rounded-card border border-seal/50 bg-seal/10 px-5 py-3 text-sm text-negative"
        >
          <span className="seal size-2.5 rounded-[2px] bg-seal" aria-hidden />
          Executor dispatch is paused globally: {global.reason}
        </p>
      )}

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          href="#health"
          label="Venues healthy"
          value={`${okCount}/${health.items.length}`}
          tone={okCount === health.items.length ? 'ok' : 'warn'}
        />
        <Stat
          href="#reviews"
          label="Matches to review"
          value={String(pending)}
          tone={pending ? 'warn' : 'ok'}
        />
        <Stat
          href="#pauses"
          label="Active pauses"
          value={String(pauses.items.length)}
          tone={pauses.items.length ? 'bad' : 'ok'}
        />
        <Stat
          href="#pauses"
          label="Vault on-chain"
          value={pauses.vaultPaused === null ? 'n/a' : pauses.vaultPaused ? 'Paused' : 'Live'}
          tone={pauses.vaultPaused === null ? 'off' : pauses.vaultPaused ? 'bad' : 'ok'}
        />
      </div>

      <Section
        id="health"
        title="Venue health"
        hint={`Quotes go stale after ${health.staleAfterSeconds}s. Error rate covers the last 24 h.`}
        action={<RefreshHealth onData={setHealth} />}
      >
        <HealthGrid items={health.items} />
      </Section>

      <Section
        id="pauses"
        title="Executor pauses"
        hint="Stops new Intent dispatches. In-flight Intents keep settling; signed ones wait and can still expire."
      >
        <Pauses pauses={pauses} venues={health.items} onData={setPauses} />
      </Section>

      <Section
        id="reviews"
        title="Match review queue"
        hint="Medium-confidence cross-Venue matches. Compare the rules, then link or reject."
      >
        <Reviews initial={initial.reviews} onPending={setPending} />
      </Section>

      <Section id="tools" title="Event tools" hint="Operator overrides. They survive re-sync.">
        <EventTools />
      </Section>
    </div>
  );
}

const TONE = {
  ok: 'bg-accent/10 text-accent',
  warn: 'bg-gold/15 text-warning',
  bad: 'bg-seal/10 text-negative',
  off: 'bg-surface-2 text-muted',
} as const;

function Stat({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  tone: keyof typeof TONE;
}) {
  return (
    <a href={href} className={`${card} slip group flex flex-col gap-3 p-5`}>
      <span className={eyebrow}>
        <Seal />
        {label}
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="font-display text-[2.25rem] leading-none font-extrabold tabular-nums">
          {value}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${TONE[tone]}`}>
          {{ ok: 'All clear', warn: 'Check', bad: 'Attention', off: 'Not set' }[tone]}
        </span>
      </span>
    </a>
  );
}

function Section({
  id,
  title,
  hint,
  action,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid scroll-mt-28 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 id={`${id}-h`} className="text-2xl">
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------- Venue health ---------- */

const STATUS: Record<VenueHealth['status'], { label: string; cls: string; dot: string }> = {
  ok: { label: 'Healthy', cls: 'bg-accent/10 text-accent', dot: 'bg-positive' },
  stale: { label: 'Stale', cls: 'bg-gold/15 text-warning', dot: 'bg-gold' },
  erroring: { label: 'Erroring', cls: 'bg-seal/10 text-negative', dot: 'bg-seal' },
  no_data: { label: 'No data', cls: 'bg-surface-2 text-muted', dot: 'bg-muted' },
};

function RefreshHealth({ onData }: { onData: (h: AdminData['health']) => void }) {
  const { busy, error, run } = useSubmit();
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-negative">{error.message}</span>}
      <button
        className={ghost}
        disabled={busy}
        onClick={() => void run(async () => onData(await api.getVenueHealth()))}
      >
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}

function HealthGrid({ items }: { items: VenueHealth[] }) {
  if (items.length === 0)
    return <EmptyState>No Venues reported yet. Is the worker running?</EmptyState>;
  return (
    <ul aria-label="Venues" className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((v) => {
        const s = STATUS[v.status];
        const rate = Math.round(v.errorRate * 1000) / 10;
        return (
          <li key={v.venueId} className={`${card} flex flex-col gap-4 p-5`}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg leading-tight font-bold">{v.name}</h3>
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${s.cls}`}
              >
                <span aria-hidden className={`size-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-muted">Last Quote</dt>
                <dd className="font-medium">
                  <Ago iso={v.lastQuoteAt} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">Last success</dt>
                <dd className="font-medium">
                  <Ago iso={v.lastSuccessAt} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">Runs / errors 24 h</dt>
                <dd className="font-mono font-medium tabular-nums">
                  {v.runs24h} / {v.errors24h}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Error rate</dt>
                <dd className="font-mono font-medium tabular-nums">{rate.toFixed(1)}%</dd>
              </div>
            </dl>
            <div
              aria-hidden
              className="h-1 overflow-hidden rounded-full bg-surface-2"
              title={`${rate.toFixed(1)}% errors`}
            >
              <div
                className={`h-full rounded-full ${rate > 20 ? 'bg-seal' : rate > 0 ? 'bg-gold' : 'bg-positive'}`}
                style={{ width: `${Math.max(rate, rate > 0 ? 4 : 100)}%` }}
              />
            </div>
            {v.lastError && (
              <p
                className="rounded-xl bg-seal/5 px-3 py-2 font-mono text-[0.7rem] break-all text-negative"
                title={v.lastError}
              >
                <span className="line-clamp-2">{v.lastError}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Pauses ---------- */

function Pauses({
  pauses,
  venues,
  onData,
}: {
  pauses: AdminData['pauses'];
  venues: VenueHealth[];
  onData: (p: AdminData['pauses']) => void;
}) {
  const [scope, setScope] = useState('global');
  const [reason, setReason] = useState('');
  const { busy, error, note, run } = useSubmit();
  const reread = async () => onData(await api.getPauses());
  const name = (s: string) =>
    s === 'global' ? 'Global' : (venues.find((v) => v.venueId === s)?.name ?? s);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="grid content-start gap-3">
        {pauses.items.length === 0 ? (
          <p className={`${card} flex items-center gap-3 p-5 text-sm text-muted`}>
            <span aria-hidden className="size-2 rounded-full bg-positive" />
            No active pauses. Executor dispatch is live.
          </p>
        ) : (
          <ul aria-label="Active pauses" className="stagger grid gap-3">
            {pauses.items.map((p) => (
              <li
                key={p.scope}
                className={`${card} flex items-center justify-between gap-4 border-seal/40 p-5`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-display text-lg font-bold">
                    <span aria-hidden className="seal size-2 rounded-[2px] bg-seal" />
                    {name(p.scope)} paused
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">
                    {p.reason} · since <Ago iso={p.pausedAt} />
                  </p>
                </div>
                <button
                  className={ghost}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.unpauseExecutor({ params: { scope: p.scope } });
                      await reread();
                      return `Lifted ${p.scope} pause`;
                    })
                  }
                >
                  Lift
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-center gap-2 px-1 text-xs text-muted">
          Vault on-chain pause:
          <span
            className={`rounded-full px-2.5 py-0.5 font-medium ${
              pauses.vaultPaused ? TONE.bad : pauses.vaultPaused === null ? 'bg-surface-2' : TONE.ok
            }`}
          >
            {pauses.vaultPaused === null
              ? 'chain not configured'
              : pauses.vaultPaused
                ? 'paused'
                : 'live'}
          </span>
          multisig only, not from here.
        </p>
        <SubmitStatus error={error} note={note} />
      </div>

      <form
        className={`${card} scroll-frame relative grid content-start gap-4 border-gold/60 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.pauseExecutor({ params: { scope }, body: { reason: reason.trim() } });
            await reread();
            setReason('');
            return `Paused ${scope}`;
          });
        }}
      >
        <p className={eyebrow}>
          <Seal />
          New pause
        </p>
        <Label text="Scope">
          <select className={field} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="global">Global (all Venues)</option>
            {venues.map((v) => (
              <option key={v.venueId} value={v.venueId}>
                {v.name}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Reason">
          <input
            className={field}
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Incident note, shown to operators"
          />
        </Label>
        <button className={danger} disabled={busy || !reason.trim()}>
          {busy ? 'Working…' : 'Pause dispatch'}
        </button>
      </form>
    </div>
  );
}

/* ---------- Review queue ---------- */

const STATUSES = ['pending', 'approved', 'rejected'] as const;
type Status = (typeof STATUSES)[number];

const tab = (on: boolean) =>
  `flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap capitalize transition ${
    on
      ? 'border-fg bg-fg text-bg before:size-1.5 before:rounded-full before:bg-seal'
      : 'border-transparent text-muted hover:border-border hover:bg-surface hover:text-fg'
  }`;

function Reviews({
  initial,
  onPending,
}: {
  initial: MatchReview[];
  onPending: (n: number) => void;
}) {
  const [status, setStatus] = useState<Status>('pending');
  const [items, setItems] = useState(initial);
  const { busy, error, note, run } = useSubmit();

  const load = (s: Status) =>
    run(async () => {
      const next = (await api.listMatchReviews({ query: { status: s, limit: 50 } })).items;
      setStatus(s);
      setItems(next);
      if (s === 'pending') onPending(next.length);
    });
  const drop = (id: string) =>
    setItems((xs) => {
      const next = xs.filter((x) => x.id !== id);
      if (status === 'pending') onPending(next.length);
      return next;
    });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav role="tablist" aria-label="Review status" className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              className={tab(status === s)}
              onClick={() => void load(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <SubmitStatus error={error} note={note} />
      </div>
      {items.length === 0 ? (
        <EmptyState>No {status} matches.</EmptyState>
      ) : (
        <div className="stagger grid gap-5">
          {items.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              busy={busy}
              act={(kind) =>
                run(async () => {
                  if (kind === 'approve') await api.approveMatchReview({ params: { id: r.id } });
                  else await api.rejectMatchReview({ params: { id: r.id } });
                  drop(r.id);
                  return kind === 'approve'
                    ? 'Linked into the Event'
                    : 'Rejected; this pair will not be proposed again';
                })
              }
              split={(m) =>
                run(async () => {
                  const { eventId } = await api.splitEvent({
                    params: { id: r.event.id },
                    body: { marketId: m.id },
                  });
                  return `Split into Event ${eventId.slice(0, 8)}`;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  review: r,
  busy,
  act,
  split,
}: {
  review: MatchReview;
  busy: boolean;
  act: (kind: 'approve' | 'reject') => void;
  split: (m: AdminMarket) => void;
}) {
  const pct = Math.round(Number(r.confidence) * 100);
  return (
    <article
      aria-label={`Match review: ${r.market.question}`}
      className="scroll-frame relative grid gap-5 overflow-hidden rounded-card border border-gold/60 bg-surface p-6"
    >
      <Image
        src="/brand/ornaments/cloud.png"
        alt=""
        width={400}
        height={270}
        className="ornament pointer-events-none absolute -top-4 -right-8 w-40 opacity-60"
      />
      <header className="relative flex flex-wrap items-start justify-between gap-4 pr-20">
        <div className="min-w-0">
          <p className={eyebrow}>
            <Seal />
            Proposed match · <Ago iso={r.createdAt} />
          </p>
          <h3 className="mt-2 font-display text-xl leading-snug font-bold text-balance">
            Into &ldquo;{r.event.title}&rdquo;
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex flex-col items-end leading-tight">
            <span className="font-display text-[2rem] font-extrabold tabular-nums">{pct}%</span>
            <span className="text-[0.7rem] text-muted">confidence</span>
          </span>
        </div>
      </header>

      <div className="relative flex flex-wrap gap-2 text-xs">
        <span
          className={`rounded-full px-2.5 py-1 font-medium ${r.direction === 'inverse' ? TONE.warn : TONE.ok}`}
        >
          {r.direction === 'inverse' ? 'Inverse Outcomes (Yes ↔ No)' : 'Same direction'}
        </span>
        {r.candidate && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-muted">
            via {r.candidate}
          </span>
        )}
        {r.status !== 'pending' && (
          <span
            className={`rounded-full px-2.5 py-1 font-medium capitalize ${r.status === 'approved' ? TONE.ok : TONE.bad}`}
          >
            {r.status}
          </span>
        )}
      </div>

      <div className="relative grid gap-4 md:grid-cols-2">
        <MarketBox label="Proposed Market" market={r.market} highlight />
        <div className="grid content-start gap-3">
          {r.event.markets.map((m) => (
            <MarketBox
              key={m.id}
              label="Already in the Event"
              market={m}
              busy={busy}
              onSplit={r.event.markets.length > 1 ? () => split(m) : undefined}
            />
          ))}
        </div>
      </div>

      {r.status === 'pending' && (
        <footer className="relative flex flex-wrap items-center justify-end gap-3 border-t border-border/70 pt-4">
          <button className={ghost} disabled={busy} onClick={() => act('reject')}>
            Reject
          </button>
          <button className={primary} disabled={busy} onClick={() => act('approve')}>
            Approve
          </button>
        </footer>
      )}
    </article>
  );
}

function MarketBox({
  label,
  market: m,
  highlight,
  onSplit,
  busy,
}: {
  label: string;
  market: AdminMarket;
  highlight?: boolean;
  onSplit?: () => void;
  busy?: boolean;
}) {
  const rules = plainText(m.rules);
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        highlight ? 'border-accent/40 bg-accent/5' : 'border-border/70 bg-surface-2/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className="font-medium text-fg">{label}</span>
          <span className="rounded-full border border-border px-2 py-0.5">{m.venueId}</span>
        </span>
        <a href={m.url} target="_blank" rel="noreferrer" className="hover:text-accent">
          Open ↗
        </a>
      </div>
      <p className="text-sm leading-snug font-medium">{m.question}</p>
      <p className="text-xs text-muted">
        {m.outcomes.join(' / ')}
        {m.endDate && (
          <>
            {' '}
            · ends <Time text={when(m.endDate)} />
          </>
        )}
      </p>
      <details className="group text-xs leading-relaxed text-muted">
        <summary className="cursor-pointer list-none font-medium text-accent">
          <span className="group-open:hidden">Show resolution rules</span>
          <span className="hidden group-open:inline">Hide rules</span>
        </summary>
        <p className="mt-2 whitespace-pre-line">{rules || 'No rules published.'}</p>
      </details>
      {onSplit && (
        <button className={`${ghost} self-start text-xs`} disabled={busy} onClick={onSplit}>
          Split into its own Event
        </button>
      )}
    </div>
  );
}

/* ---------- Event tools: merge + relabel ---------- */

function EventTools() {
  const merge = useSubmit();
  const relabel = useSubmit();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [eventId, setEventId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');

  return (
    <div className="stagger grid gap-4 md:grid-cols-2">
      <form
        className={`${card} grid content-start gap-4 p-6`}
        onSubmit={(e) => {
          e.preventDefault();
          void merge.run(async () => {
            const { eventId: id } = await api.mergeEvents({
              body: { sourceEventId: source.trim(), targetEventId: target.trim() },
            });
            return `Merged into Event ${id}`;
          });
        }}
      >
        <div>
          <h3 className="font-display text-lg font-bold">Merge Events</h3>
          <p className="mt-1 text-xs text-muted">
            Moves every Market of the source into the target.
          </p>
        </div>
        <Label text="Source Event id">
          <input
            className={field}
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </Label>
        <Label text="Target Event id">
          <input
            className={field}
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Label>
        <button className={`${primary} justify-self-start`} disabled={merge.busy}>
          {merge.busy ? 'Merging…' : 'Merge'}
        </button>
        <SubmitStatus error={merge.error} note={merge.note} />
      </form>

      <form
        className={`${card} grid content-start gap-4 p-6`}
        onSubmit={(e) => {
          e.preventDefault();
          void relabel.run(async () => {
            const body = {
              ...(title.trim() && { title: title.trim() }),
              ...(category.trim() && { category: category.trim() }),
            };
            const r = await api.updateEventLabels({ params: { id: eventId.trim() }, body });
            return `Relabelled: ${r.title}${r.category ? ` · ${r.category}` : ''}`;
          });
        }}
      >
        <div>
          <h3 className="font-display text-lg font-bold">Relabel an Event</h3>
          <p className="mt-1 text-xs text-muted">Fix a title or category. It survives re-sync.</p>
        </div>
        <Label text="Event id">
          <input
            className={field}
            required
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
        </Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="Title">
            <input
              className={field}
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Label>
          <Label text="Category">
            <input
              className={field}
              maxLength={80}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Label>
        </div>
        <button
          className={`${primary} justify-self-start`}
          disabled={relabel.busy || (!title.trim() && !category.trim())}
        >
          {relabel.busy ? 'Saving…' : 'Relabel'}
        </button>
        <SubmitStatus error={relabel.error} note={relabel.note} />
      </form>
    </div>
  );
}
