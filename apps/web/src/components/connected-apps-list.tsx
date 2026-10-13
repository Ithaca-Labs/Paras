'use client';

import type { ConnectedApp } from '@paras/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, ErrorState } from './states';

export function ConnectedAppsList({ initial }: { initial: ConnectedApp[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    try {
      await api.revokeConnectedApp({ params: { id } });
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch {
      setError('Could not revoke. Try again.');
    }
  }

  if (items.length === 0 && !error) return <EmptyState>No connected apps.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorState message={error} />}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">{a.client.name}</p>
              <p className="text-xs text-muted">
                {a.scopes.join(', ')} · connected {new Date(a.connectedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => revoke(a.id)}
              className="rounded-sm border border-border px-3 py-1.5 text-sm text-negative"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
