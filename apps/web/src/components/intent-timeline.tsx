'use client';

import type { IntentView } from '@paras/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const TERMINAL = ['filled', 'partially_filled', 'failed', 'expired', 'cancelled'];
const LABEL: Record<string, string> = {
  previewed: 'Previewed',
  signed: 'Signed, funds reserved',
  dispatched: 'Dispatched to Executor',
  bridging: 'Bridging to Polygon',
  bridged: 'Bridged',
  ordering: 'Placing order',
  returning: 'Returning unspent funds',
  filled: 'Filled',
  partially_filled: 'Partially filled',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

/** Polls the Intent until it reaches a terminal status. */
export function IntentTimeline({
  id,
  onStatus,
}: {
  id: string;
  onStatus?: (i: IntentView) => void;
}) {
  const [intent, setIntent] = useState<IntentView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const i = await api.getIntent({ params: { id } });
        if (!live) return;
        setIntent(i);
        setErr(null);
        onStatus?.(i);
        if (!TERMINAL.includes(i.status)) timer = setTimeout(tick, 3000);
      } catch (e) {
        if (!live) return;
        setErr(e instanceof Error ? e.message : 'Could not load status');
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (!intent) return <p className="text-sm text-muted">{err ?? 'Loading status…'}</p>;
  return (
    <div aria-label="Intent status">
      <ol className="space-y-1 text-sm">
        {intent.timeline.map((t) => (
          <li key={`${t.status}-${t.at}`} className="flex gap-2">
            <span className="text-muted tabular-nums">{new Date(t.at).toLocaleTimeString()}</span>
            <span>{LABEL[t.status] ?? t.status}</span>
            {t.reason && <span className="text-muted">({t.reason})</span>}
          </li>
        ))}
      </ol>
      {intent.filledShares && (
        <p className="mt-2 text-sm">
          {intent.filledShares} shares for {intent.spent ?? '—'} USDC
        </p>
      )}
      {intent.reason && <p className="mt-2 text-sm text-negative">{intent.reason}</p>}
    </div>
  );
}
