'use client';

import { HISTORY_INTERVALS, type EventHistory } from '@paras/shared';
import { useState } from 'react';
import { api } from '@/lib/api';

// One stroke token + dash per Venue so series differ without raw colors.
const STROKES = [
  'stroke-accent',
  'stroke-seal',
  'stroke-indigo',
  'stroke-gold',
  'stroke-fg',
] as const;
const DASH = [undefined, '6 3', '2 3', '8 3 2 3', '1 4'] as const;
const W = 640;
const H = 220;
const PAD = { l: 36, r: 8, t: 8, b: 20 };

/** Plain-SVG cross-Venue price history. Interval / Outcome switches refetch via the typed client. */
export function PriceChart({ eventId, initial }: { eventId: string; initial: EventHistory }) {
  const [h, setH] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = async (interval: EventHistory['interval'], outcome: string) => {
    setBusy(true);
    try {
      setH(await api.getEventHistory({ params: { id: eventId }, query: { interval, outcome } }));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const n = h.timestamps.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (p: number) => PAD.t + (1 - p) * (H - PAD.t - PAD.b);
  const paths = h.series.map((s) => {
    let d = '';
    s.prices.forEach((p, i) => {
      if (p == null) return;
      d += `${d && s.prices[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p)).toFixed(1)}`;
    });
    return d;
  });
  const hasData = paths.some(Boolean);

  return (
    <section aria-labelledby="hist-h" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hist-h" className="text-2xl">
          Price history
        </h2>
        <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface p-1 text-xs">
          {h.outcomes.length > 1 && (
            <select
              aria-label="Outcome"
              value={h.outcome}
              onChange={(e) => load(h.interval, e.target.value)}
              className="rounded-full border border-border bg-surface px-3 py-1"
            >
              {h.outcomes.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
          {HISTORY_INTERVALS.map((i) => (
            <button
              key={i}
              onClick={() => load(i, h.outcome)}
              aria-pressed={i === h.interval}
              className={`rounded-full px-3 py-1 ${
                i === h.interval ? 'bg-fg text-bg' : 'text-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`rounded-card border border-border bg-surface p-5 transition-opacity ${busy ? 'opacity-60' : ''}`}
      >
        {error && (
          <p role="alert" className="text-sm text-negative">
            Could not load history.
          </p>
        )}
        {hasData ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${h.outcome} price history`}
            className="w-full"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={y(p)}
                  y2={y(p)}
                  className="stroke-border"
                  strokeDasharray="2 4"
                />
                <text
                  x={PAD.l - 4}
                  y={y(p) + 3}
                  textAnchor="end"
                  className="fill-muted text-[10px]"
                >
                  {Math.round(p * 100)}¢
                </text>
              </g>
            ))}
            {n > 0 && (
              <>
                <text x={PAD.l} y={H - 4} className="fill-muted text-[10px]">
                  {new Date(h.timestamps[0]!).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </text>
                <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-muted text-[10px]">
                  {new Date(h.timestamps[n - 1]!).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </text>
              </>
            )}
            {paths.map((d, i) => (
              <path
                key={h.series[i]!.marketId}
                d={d}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={DASH[i % DASH.length]}
                className={STROKES[i % STROKES.length]}
              />
            ))}
          </svg>
        ) : (
          <p className="p-6 text-sm text-muted">No history yet.</p>
        )}
        <ul className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
          {h.series.map((s, i) => (
            <li key={s.marketId} className="flex items-center gap-1.5">
              <svg width="20" height="6" aria-hidden>
                <line
                  x1="0"
                  x2="20"
                  y1="3"
                  y2="3"
                  strokeWidth={2}
                  strokeDasharray={DASH[i % DASH.length]}
                  className={STROKES[i % STROKES.length]}
                />
              </svg>
              {s.venueId}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
