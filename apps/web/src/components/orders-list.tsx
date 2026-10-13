'use client';

import type { Order } from '@paras/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cents } from '@/lib/format';
import { btnCls, SubmitStatus, useSubmit } from '@/lib/use-submit';
import { useSession } from './providers';
import { EmptyState, ErrorState } from './states';

const LABEL = { limit_buy: 'Limit buy', take_profit: 'Take-profit', stop_loss: 'Stop-loss' };

export function OrdersList() {
  const { user, loading } = useSession();
  const [items, setItems] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { busy, error, run } = useSubmit();
  const load = useCallback(() => {
    setFailed(false);
    api.listOrders().then(
      (r) => setItems(r.items),
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!user) return <EmptyState>Sign in to see your orders.</EmptyState>;
  if (failed) return <ErrorState message="Could not load orders." onRetry={load} />;
  if (!items) return <p className="text-sm text-muted">Loading…</p>;
  if (!items.length) return <EmptyState>No orders yet.</EmptyState>;
  return (
    <div className="grid gap-3">
      {items.map((o) => (
        <div
          key={o.id}
          className="ink-card flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-4 text-sm"
        >
          <strong>{LABEL[o.kind]}</strong>
          <span>{o.outcome ?? 'position'}</span>
          <span className="text-muted">
            trigger {cents(o.triggerPrice)}
            {o.amount && ` · ${o.amount} USDC`}
          </span>
          <span className="text-muted">{o.status}</span>
          {o.reason && <span className="text-negative">{o.reason}</span>}
          {o.status === 'open' && (
            <button
              className={`${btnCls} ml-auto`}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.cancelOrder({ params: { id: o.id } });
                  load();
                })
              }
            >
              Cancel
            </button>
          )}
        </div>
      ))}
      <SubmitStatus error={error} note={null} />
    </div>
  );
}
