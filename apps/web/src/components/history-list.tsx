'use client';

import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-api';
import { EmptyState, ErrorState } from './states';

const STATE_CLASS: Record<string, string> = {
  complete: 'text-positive',
  failed: 'text-negative',
  delayed: 'text-warning',
};

/** Vault activity, newest first (Envio-backed), each with explorer links. */
export function HistoryList() {
  const h = useLoad(() => api.listHistory({ query: { limit: 50 } }));
  if (h.error) return <ErrorState message={h.error} onRetry={h.reload} />;
  if (!h.data) return <div className="h-24 animate-pulse rounded-card bg-surface-2" />;
  if (h.data.items.length === 0) return <EmptyState>No activity yet.</EmptyState>;
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-surface">
      {h.data.items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
          <span className="w-24 capitalize">{i.kind}</span>
          <span className="tabular-nums">{i.amount ? `${i.amount} USDC` : ''}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{i.question ?? ''}</span>
          <span className={STATE_CLASS[i.state] ?? 'text-muted'}>
            {i.state}
            {i.reason ? ` (${i.reason})` : ''}
          </span>
          <time className="text-muted" dateTime={i.at}>
            {new Date(i.at).toLocaleString()}
          </time>
          {i.txs.map((t) => (
            <a key={t.hash} href={t.url} target="_blank" rel="noreferrer" className="underline">
              {t.label}
            </a>
          ))}
        </li>
      ))}
    </ul>
  );
}
