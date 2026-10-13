'use client';

import type { IntentPreview } from '@paras/shared';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { errMsg, useLoad } from '@/lib/use-api';
import { useVaultWallet } from '@/lib/use-vault-wallet';
import { publicClient, validAmount, vaultAbi } from '@/lib/vault-chain';
import { DemoBanner } from './demo-banner';
import { LimitOrderForm } from './limit-order-form';
import { OneClickBet } from './one-click-bet';
import { IntentTimeline } from './intent-timeline';
import { useSession } from './providers';
import { ErrorState } from './states';
import { VaultGate } from './vault-gate';

const btn =
  'w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';
const input =
  'mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none';

export interface BetContext {
  eventId: string;
  outcome: string;
  amount: string;
  maxPrice: string;
}

/**
 * Bet on an Event through the Vault: Intent preview -> EIP-712 signature -> on-chain submit -> status.
 * Prefills from Magic Link query params `outcome`, `amount`, `maxPrice`.
 * `extension` renders below the form with the current selection: one-click and limit controls (#109) are built in; this is for further controls.
 */
export function BetPanel(props: { eventId: string; extension?: (ctx: BetContext) => ReactNode }) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-surface-2" />}>
      <Panel {...props} />
    </Suspense>
  );
}

function Panel({
  eventId,
  extension,
}: {
  eventId: string;
  extension?: (c: BetContext) => ReactNode;
}) {
  const q = useSearchParams();
  const cfg = useLoad(() => api.getConfig());
  return (
    <section
      id="bet"
      className="scroll-frame relative overflow-hidden rounded-card border border-gold/60 bg-surface p-6 shadow-[0_18px_40px_-30px_rgb(30_43_63/0.5)]"
      aria-label="Bet with the Vault"
    >
      <h2 className="text-xl">Bet with the Vault</h2>
      <p className="mt-1 mb-4 text-xs text-muted">
        You pick the Outcome and amount. The Vault routes to the best Venue.
      </p>
      {cfg.data?.demoMode && <DemoBanner />}
      <VaultGate>
        <Form
          eventId={eventId}
          vault={cfg.data?.vault ?? null}
          initial={{
            outcome: q.get('outcome') ?? '',
            amount: q.get('amount') ?? '',
            maxPrice: q.get('maxPrice') ?? '',
          }}
          extension={extension}
        />
      </VaultGate>
    </section>
  );
}

function Form({
  eventId,
  vault,
  initial,
  extension,
}: {
  eventId: string;
  vault: { address: string } | null;
  initial: { outcome: string; amount: string; maxPrice: string };
  extension?: (c: BetContext) => ReactNode;
}) {
  const { user } = useSession();
  const { address, client } = useVaultWallet();
  const event = useLoad(() => api.getEvent({ params: { id: eventId } }), [eventId]);
  const [outcome, setOutcome] = useState(initial.outcome);
  const [amount, setAmount] = useState(initial.amount);
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice);
  const [preview, setPreview] = useState<IntentPreview | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (event.error) return <ErrorState message={event.error} onRetry={event.reload} />;
  const labels = [
    ...new Set(event.data?.markets.flatMap((m) => m.outcomes.map((o) => o.label)) ?? []),
  ];
  const selected =
    labels.find((l) => l.toLowerCase() === outcome.toLowerCase()) ??
    (outcome ? outcome : (labels[0] ?? ''));
  const price = Number(maxPrice);
  const valid = !!selected && validAmount(amount) && price > 0 && price < 1;
  const reset = () => {
    setPreview(null);
    setErr(null);
  };

  const doPreview = async () => {
    if (!address) return;
    setBusy(true);
    reset();
    try {
      setPreview(
        await api.previewIntent({
          body: { eventId, outcome: selected, user: address, amount, maxPrice },
        }),
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const signAndSubmit = async () => {
    const intent = preview?.intent;
    if (!intent || !address || !vault) return;
    setBusy(true);
    setErr(null);
    try {
      const wallet = await client();
      const { domain, types, primaryType, message } = intent.typedData;
      setStep('Sign the Intent in your wallet…');
      const signature = await wallet.signTypedData({
        account: address,
        domain: { ...domain, verifyingContract: domain.verifyingContract as `0x${string}` },
        types,
        primaryType,
        message: {
          user: message.user as `0x${string}`,
          id: message.id as `0x${string}`,
          amount: BigInt(message.amount),
          expiry: BigInt(message.expiry),
          detailsHash: message.detailsHash as `0x${string}`,
        },
      });
      setStep('Submitting on-chain…');
      const hash = await wallet.writeContract({
        address: vault.address as `0x${string}`,
        abi: vaultAbi,
        functionName: 'submitIntent',
        args: [
          {
            user: message.user as `0x${string}`,
            id: message.id as `0x${string}`,
            amount: BigInt(message.amount),
            expiry: BigInt(message.expiry),
            detailsHash: message.detailsHash as `0x${string}`,
          },
          signature,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setIntentId(intent.id);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const cancel = async () => {
    if (!preview?.intent || !vault) return;
    setBusy(true);
    try {
      const wallet = await client();
      const hash = await wallet.writeContract({
        address: vault.address as `0x${string}`,
        abi: vaultAbi,
        functionName: 'cancelIntent',
        args: [preview.intent.typedData.message.id as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (intentId)
    return (
      <div className="space-y-3">
        <IntentTimeline id={intentId} />
        <div className="flex gap-3">
          <button className="text-sm underline" onClick={cancel} disabled={busy}>
            Cancel (if not yet dispatched)
          </button>
          <button
            className="text-sm underline"
            onClick={() => {
              setIntentId(null);
              reset();
            }}
          >
            New bet
          </button>
        </div>
        {err && (
          <p role="alert" className="text-sm text-negative">
            {err}
          </p>
        )}
      </div>
    );

  const e = preview?.route?.expected;
  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <label className="text-sm">
          Outcome
          <select
            className={input}
            value={selected}
            onChange={(ev) => (setOutcome(ev.target.value), reset())}
          >
            {labels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Amount (USDC)
          <input
            className={input}
            inputMode="decimal"
            value={amount}
            onChange={(ev) => (setAmount(ev.target.value), reset())}
          />
        </label>
        <label className="text-sm">
          Max price (0-1)
          <input
            className={input}
            inputMode="decimal"
            placeholder="0.60"
            value={maxPrice}
            onChange={(ev) => (setMaxPrice(ev.target.value), reset())}
          />
        </label>
      </div>
      <button className={btn} disabled={busy || !valid || !address || !user} onClick={doPreview}>
        Preview
      </button>

      {preview && (
        <div
          className="space-y-2 rounded-sm border border-border p-3 text-sm"
          aria-label="Intent preview"
        >
          {preview.blockers.length > 0 && (
            <ul className="list-inside list-disc text-negative">
              {preview.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {e && preview.route && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <Row k="Venue" v={preview.route.venueId} />
              <Row k="Shares" v={e.shares} />
              <Row k="Avg price" v={e.avgPrice} />
              <Row k="Fees" v={e.fees} />
              <Row k="Bridge + swap" v={e.overhead} />
              <Row k="Spend" v={e.spent} />
              <Row k="Unspent (returned)" v={e.unspent} />
            </dl>
          )}
          {preview.noRoute && (
            <p className="text-muted">
              No route ({preview.noRoute.reason.replace(/_/g, ' ')}).{' '}
              {preview.noRoute.redirects.map((r) => (
                <a
                  key={r.venueId}
                  href={r.redirectUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Bet on {r.venueId}
                </a>
              ))}
            </p>
          )}
          {preview.hint && (
            <p className="text-warning">
              {preview.hint.venueId} would give {preview.hint.extraShares} more shares for the same
              stake.{' '}
              <a
                href={preview.hint.redirectUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Bet there
              </a>
            </p>
          )}
          {preview.intent && preview.blockers.length === 0 && (
            <button className={btn} disabled={busy} onClick={signAndSubmit}>
              Sign and submit Intent
            </button>
          )}
          {step && <p className="text-muted">{step}</p>}
        </div>
      )}
      {err && (
        <p role="alert" className="text-sm text-negative">
          {err}
        </p>
      )}
      {selected && (
        <div className="grid gap-4 border-t border-border pt-3">
          <OneClickBet eventId={eventId} outcome={selected} />
          <LimitOrderForm eventId={eventId} outcome={selected} />
        </div>
      )}
      {extension?.({ eventId, outcome: selected, amount, maxPrice })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
