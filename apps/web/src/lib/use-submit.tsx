'use client';

import { ApiError } from '@paras/shared';
import Link from 'next/link';
import { useState } from 'react';

export const inputCls = 'w-full rounded-sm border border-border bg-bg px-3 py-1.5 text-sm';
export const btnCls =
  'rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';

/** Runs an API action; keeps the error (or a success note) for <SubmitStatus>. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote((await fn()) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, note, run };
}

export function SubmitStatus({ error, note }: { error: Error | null; note: string | null }) {
  if (error) {
    const noDelegation =
      error instanceof ApiError && error.body?.error.code === 'no_active_delegation';
    return (
      <p role="alert" className="text-sm text-negative">
        {error.message}
        {noDelegation && (
          <>
            {' '}
            <Link href="/settings" className="underline">
              Enable one-click trading
            </Link>
          </>
        )}
      </p>
    );
  }
  return note ? <p className="text-sm text-positive">{note}</p> : null;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}
