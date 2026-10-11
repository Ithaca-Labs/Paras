'use client';

import { useSigners } from '@privy-io/react-auth';
import type { Delegation } from '@paras/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { btnCls, Field, inputCls, SubmitStatus, useSubmit } from '@/lib/use-submit';
import { useSession } from './providers';
import { EmptyState } from './states';

export function DelegationSettings() {
  const { configured, user, loading } = useSession();
  if (!configured) return <EmptyState>Sign-in is not configured.</EmptyState>;
  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!user) return <EmptyState>Sign in to manage one-click trading.</EmptyState>;
  return <Panel />;
}

function Panel() {
  const { addSigners, removeSigners } = useSigners();
  const [d, setD] = useState<Delegation | null>(null);
  const [maxIntent, setMaxIntent] = useState('50');
  const [cap, setCap] = useState('200');
  const { busy, error, note, run } = useSubmit();

  useEffect(() => {
    api.getDelegation().then(setD, () => undefined);
  }, []);

  const grant = () =>
    run(async () => {
      // The API returns Paras's signer id + policy ids; no public env var needed.
      const pending = await api.grantDelegation({ body: { maxIntent, cap } });
      if (!pending.wallet || !pending.signerId) throw new Error('No embedded wallet to delegate');
      await addSigners({
        address: pending.wallet,
        signers: [{ signerId: pending.signerId, policyIds: pending.policyIds }],
      });
      setD(await api.confirmDelegation());
      return 'One-click trading enabled';
    });

  const revoke = () =>
    run(async () => {
      const revoked = await api.revokeDelegation();
      setD(revoked);
      // Paras's side is already off; also drop the signer at Privy (best effort).
      if (revoked.wallet) await removeSigners({ address: revoked.wallet }).catch(() => undefined);
      return 'Delegation revoked';
    });

  const active = d?.status === 'active';
  return (
    <section className="grid max-w-xl gap-4 rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">One-click trading</h2>
      <p className="text-sm text-muted">
        Lets Paras sign for your embedded wallet, so one-click bets and limit, take-profit and
        stop-loss orders run without a prompt. It can only sign Vault Intents and exits, and submit
        or cancel them. Funds only move to your own Deposit Wallet or back to you. You choose the
        Event, Outcome and amount; Paras never trades on its own. Each Intent is capped at the
        per-bet max, and total spend at the cap. Revoke any time.
      </p>
      <p className="text-sm">
        Status: <strong>{d?.status ?? '…'}</strong>
        {active && d && (
          <span className="text-muted">
            {' '}
            · per bet max {d.maxIntent} USDC · spent {d.spent} of {d.cap} USDC
          </span>
        )}
      </p>
      {active ? (
        <button className={btnCls} disabled={busy} onClick={() => void revoke()}>
          {busy ? 'Revoking…' : 'Revoke'}
        </button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void grant();
          }}
        >
          <Field label="Max per bet (USDC)">
            <input
              className={inputCls}
              inputMode="decimal"
              required
              value={maxIntent}
              onChange={(e) => setMaxIntent(e.target.value)}
            />
          </Field>
          <Field label="Total cap (USDC)">
            <input
              className={inputCls}
              inputMode="decimal"
              required
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </Field>
          <button className={btnCls} disabled={busy}>
            {busy ? 'Enabling…' : 'Enable one-click trading'}
          </button>
        </form>
      )}
      <SubmitStatus error={error} note={note} />
    </section>
  );
}
