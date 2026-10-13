'use client';

import type { EventComparison, EventView, QuoteView } from '@paras/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { centsPrecise, cents, perShare, usd, when } from '@/lib/format';
import { VenueAction } from './venue-action';
import { VenueLabel } from './venue-label';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Cross-Venue comparison (with stake input -> estimated fill), plus order-book depth.
 * Live: subscribes to the Event's SSE stream; each Quote refreshes depth immediately and
 * re-fetches the (fee/fill-adjusted) comparison, debounced.
 */
export function EventLive({ event, initial }: { event: EventView; initial: EventComparison }) {
  const [stake, setStake] = useState('');
  const [cmp, setCmp] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, QuoteView>>({});
  const stakeRef = useRef(stake);
  stakeRef.current = stake;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const s = stakeRef.current.trim();
      if (s && !DECIMAL.test(s)) return setError('Stake must be a number');
      try {
        setCmp(
          await api.compareEvent({
            params: { id: event.id },
            query: s && Number(s) > 0 ? { stake: s } : {},
          }),
        );
        setError(null);
      } catch {
        setError('Could not refresh prices');
      }
    }, delay);
  };

  // Stake changes: debounce 400ms. Mount-time fetch is skipped (server provided `initial`).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh(400);
    return () => clearTimeout(timer.current);
  }, [stake]);

  useEffect(() => {
    const es = new EventSource(`/v1/events/${event.id}/stream`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // EventSource reconnects by itself
    es.addEventListener('quote', (e) => {
      const m = JSON.parse((e as MessageEvent<string>).data) as {
        outcomeId: string;
        quote: QuoteView;
      };
      setQuotes((q) => ({ ...q, [m.outcomeId]: m.quote }));
      refresh(1000);
    });
    return () => {
      es.close();
      clearTimeout(timer.current);
    };
  }, [event.id]);

  const market = (id: string) => event.markets.find((m) => m.id === id);

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="cmp-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 id="cmp-h" className="text-2xl">
              Compare Venues
            </h2>
            <span
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                live ? 'border-positive/40 text-positive' : 'border-border text-muted'
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-positive' : 'bg-muted'}`}
              />
              {live ? 'Live' : 'Connecting'}
            </span>
          </div>
          <label className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pr-1 pl-4 text-xs text-muted focus-within:border-accent">
            Estimate fill for
            <span className="flex items-center rounded-full bg-surface-2 px-3 py-1 text-sm text-fg">
              $
              <input
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                placeholder="100"
                aria-label="Stake (USD) for estimated fill"
                className="w-16 bg-transparent pl-0.5 focus:outline-none"
              />
            </span>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        {cmp.outcomes.map((o) => (
          <div
            key={o.label}
            className="overflow-hidden rounded-card border border-border bg-surface shadow-[0_10px_30px_-26px_rgb(30_43_63/0.5)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-5 py-3">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold">
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${/^no$/i.test(o.label) ? 'bg-seal' : 'bg-accent'}`}
                />
                {o.label.charAt(0).toUpperCase() + o.label.slice(1).toLowerCase()}
              </h3>
              {o.divergent && (
                <span className="rounded-full border border-seal/40 px-2.5 py-0.5 text-xs text-negative">
                  Venues diverge by {centsPrecise(o.spread)}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[0.7rem] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Venue</th>
                    <th className="px-3 font-medium">Bid / Ask</th>
                    <th className="px-3 font-medium">Fee</th>
                    <th className="px-3 font-medium">Effective ask</th>
                    {cmp.stake && <th className="px-3 font-medium">Fill for ${cmp.stake}</th>}
                    <th className="px-5" />
                  </tr>
                </thead>
                <tbody>
                  {o.venues.map((v) => {
                    const best = o.best?.marketId === v.marketId;
                    const m = market(v.marketId);
                    return (
                      <tr
                        key={v.marketId}
                        aria-label={best ? `${v.venue.name} (best)` : v.venue.name}
                        className={`border-t border-border/70 align-middle transition-colors hover:bg-surface-2/50 ${
                          best ? 'bg-accent/[0.06] shadow-[inset_3px_0_0_var(--accent)]' : ''
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{v.venue.name}</span>
                            {best && (
                              <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-medium text-accent-fg">
                                Best
                              </span>
                            )}
                            {v.stale && (
                              <span className="flex items-center gap-1 text-xs text-warning">
                                <span aria-hidden className="size-1.5 rounded-full bg-gold" />
                                stale
                              </span>
                            )}
                          </div>
                          {m && (
                            <div className="mt-1.5">
                              <VenueLabel label={m.venue.label} />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 font-mono whitespace-nowrap tabular-nums">
                          {cents(v.bid)} <span className="text-muted">/</span> {cents(v.ask)}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-muted tabular-nums">
                          {centsPrecise(v.feePerShare)}
                        </td>
                        <td
                          className={`px-3 py-3.5 font-mono tabular-nums ${best ? 'font-semibold text-accent' : ''}`}
                        >
                          {perShare(v.effectiveAsk)}
                        </td>
                        {cmp.stake && (
                          <td className="px-3 py-3.5 font-mono text-xs tabular-nums">
                            {v.fill ? (
                              <>
                                {Number(v.fill.shares).toFixed(2)} shares @{' '}
                                {perShare(v.fill.effectivePrice)}
                                <br />
                                <span className="text-muted">
                                  fees ${Number(v.fill.fees).toFixed(2)}
                                </span>
                                {Number(v.fill.unspent) > 0 && (
                                  <span className="text-warning">
                                    {' '}
                                    partial, ${Number(v.fill.unspent).toFixed(2)} unfilled
                                  </span>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td className="px-5 py-3.5 text-right">
                          {m && (
                            <VenueAction
                              venueName={v.venue.name}
                              availability={m.availability}
                              redirectUrl={v.redirectUrl}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">
          As of {when(cmp.asOf)}. Effective ask includes Venue fees.
        </p>
      </section>

      <Depth event={event} quotes={quotes} />
    </div>
  );
}

/** Resting USD on each side of each Venue's first Outcome, bars scaled to the deepest side. */
function Depth({ event, quotes }: { event: EventView; quotes: Record<string, QuoteView> }) {
  const rows = event.markets.flatMap((m) => {
    const o = m.outcomes[0];
    const q = o && (quotes[o.id] ?? o.quote);
    return q ? [{ id: m.id, name: m.venue.name, label: o.label, q }] : [];
  });
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.q.bidDepth), Number(r.q.askDepth)]));
  const w = (v: string) => `${Math.min(100, (Number(v) / max) * 100)}%`;
  return (
    <section aria-labelledby="depth-h" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="depth-h" className="text-2xl">
          Depth
        </h2>
        <p className="text-xs text-muted">Resting orders on each side of the book</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-sm text-muted">
          No order book data yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 rounded-card border border-border bg-surface">
          {rows.map((r) => (
            <li
              key={r.id}
              className="grid items-center gap-3 px-5 py-4 text-xs sm:grid-cols-[9rem_1fr]"
            >
              <span className="text-sm font-medium">
                {r.name} <span className="font-normal text-muted">{r.label}</span>
              </span>
              <div>
                <div className="mb-1.5 flex justify-between text-muted">
                  <span>
                    Bids <span className="font-mono text-fg">{usd(r.q.bidDepth)}</span>
                  </span>
                  <span>
                    Asks <span className="font-mono text-fg">{usd(r.q.askDepth)}</span>
                  </span>
                </div>
                {/* Bids grow left from the centre, asks grow right. */}
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex h-2.5 justify-end rounded-l-full bg-surface-2">
                    <div
                      className="ink-stroke h-full rounded-l-full bg-positive"
                      style={{ width: w(r.q.bidDepth) }}
                    />
                  </div>
                  <div className="h-2.5 rounded-r-full bg-surface-2">
                    <div
                      className="ink-stroke h-full rounded-r-full bg-seal"
                      style={{ width: w(r.q.askDepth) }}
                    />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
