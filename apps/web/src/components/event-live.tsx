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
    <div className="flex flex-col gap-6">
      <section aria-labelledby="cmp-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="cmp-h" className="text-lg font-medium">
            Compare Venues
            <span
              className={`ml-3 text-xs font-normal ${live ? 'text-positive' : 'text-muted'}`}
              aria-live="polite"
            >
              {live ? '● live' : '○ connecting'}
            </span>
          </h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Stake (USD) for estimated fill
            <input
              inputMode="decimal"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="e.g. 100"
              className="w-40 rounded-sm border border-border bg-surface px-3 py-1.5 text-sm text-fg"
            />
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
            className="overflow-x-auto rounded-card border border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <h3 className="font-medium">{o.label}</h3>
              {o.divergent && (
                <span className="text-xs text-warning">
                  Venues diverge by {centsPrecise(o.spread)}
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal">Venue</th>
                  <th className="px-2 font-normal">Bid / Ask</th>
                  <th className="px-2 font-normal">Fee / share</th>
                  <th className="px-2 font-normal">Effective ask</th>
                  {cmp.stake && <th className="px-2 font-normal">Est. fill for ${cmp.stake}</th>}
                  <th className="px-4 font-normal" />
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
                      className={`border-t border-border align-top ${best ? 'bg-surface-2' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{v.venue.name}</span>
                          {best && <span className="text-xs text-positive">Best</span>}
                          {v.stale && <span className="text-xs text-warning">stale</span>}
                        </div>
                        {m && (
                          <div className="mt-1">
                            <VenueLabel label={m.venue.label} />
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 font-mono tabular-nums">
                        {cents(v.bid)} / {cents(v.ask)}
                      </td>
                      <td className="px-2 py-3 font-mono tabular-nums">
                        {centsPrecise(v.feePerShare)}
                      </td>
                      <td className="px-2 py-3 font-mono tabular-nums">
                        {perShare(v.effectiveAsk)}
                      </td>
                      {cmp.stake && (
                        <td className="px-2 py-3 font-mono text-xs tabular-nums">
                          {v.fill ? (
                            <>
                              {Number(v.fill.shares).toFixed(2)} shares @{' '}
                              {perShare(v.fill.effectivePrice)}
                              <br />
                              fees ${Number(v.fill.fees).toFixed(2)}
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
                      <td className="px-4 py-3 text-right">
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
        ))}
        <p className="text-xs text-muted">
          As of {when(cmp.asOf)}. Fees included in effective ask.
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
  const bar = (v: string, cls: string) => (
    <div className="h-2 rounded-full bg-surface-2">
      <div
        className={`h-2 rounded-full ${cls}`}
        style={{ width: `${Math.min(100, (Number(v) / max) * 100)}%` }}
      />
    </div>
  );
  return (
    <section aria-labelledby="depth-h" className="flex flex-col gap-3">
      <h2 id="depth-h" className="text-lg font-medium">
        Depth
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No order book data yet.</p>
      ) : (
        <ul className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3 text-xs">
              <span className="text-sm">
                {r.name} <span className="text-muted">{r.label}</span>
              </span>
              <div>
                <div className="mb-1 text-muted">Bids {usd(r.q.bidDepth)}</div>
                {bar(r.q.bidDepth, 'bg-positive')}
              </div>
              <div>
                <div className="mb-1 text-muted">Asks {usd(r.q.askDepth)}</div>
                {bar(r.q.askDepth, 'bg-negative')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
