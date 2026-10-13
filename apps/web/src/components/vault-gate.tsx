'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errMsg, useLoad } from '@/lib/use-api';
import { useSession } from './providers';
import { EmptyState, ErrorState } from './states';

const REASON: Record<string, string> = {
  country_unknown: 'We could not detect your country.',
  attestation_required: 'Confirm your country of residence.',
  country_mismatch: 'Your stated country does not match your connection.',
  no_routable_venue: 'No Venue available in your country can take Vault bets.',
  disclosures_not_acknowledged: 'Read and accept the risk disclosures.',
};

const card = 'rounded-card border border-border bg-surface p-5';
const btn =
  'rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';

/** Renders `children` only for a signed-in, Vault-eligible User; else the step to fix it (or a redirect to discovery). */
export function VaultGate({ children }: { children: React.ReactNode }) {
  const { configured, loading: sessionLoading, user, signIn } = useSession();
  if (sessionLoading) return <div className="h-32 animate-pulse rounded-card bg-surface-2" />;
  if (!user)
    return (
      <div className={card}>
        <p className="mb-3 text-sm text-muted">Sign in to use the Vault.</p>
        <button className={btn} disabled={!configured} onClick={signIn}>
          Sign in
        </button>
      </div>
    );
  return <Eligibility>{children}</Eligibility>;
}

function Eligibility({ children }: { children: React.ReactNode }) {
  const elig = useLoad(() => api.getVaultEligibility());
  const disc = useLoad(() => api.getDisclosures());
  const [country, setCountry] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (elig.error || disc.error) return <ErrorState message={elig.error ?? disc.error!} />;
  const e = elig.data;
  const d = disc.data;
  if (!e || !d) return <div className="h-32 animate-pulse rounded-card bg-surface-2" />;
  if (e.eligible) return <>{children}</>;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      elig.reload();
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  };
  const needDisclosures = e.reasons.includes('disclosures_not_acknowledged');
  const needCountry = e.reasons.some((r) =>
    ['country_unknown', 'attestation_required', 'country_mismatch'].includes(r),
  );
  const blocked = e.reasons.includes('no_routable_venue') && !needCountry && !needDisclosures;

  return (
    <div className="space-y-4">
      <div className={card} role="status">
        <h2 className="font-medium">Vault not available yet</h2>
        <ul className="mt-2 list-inside list-disc text-sm text-muted">
          {e.reasons.map((r) => (
            <li key={r}>{REASON[r] ?? r}</li>
          ))}
        </ul>
      </div>

      {needCountry && (
        <form
          className={`${card} flex flex-wrap items-end gap-3`}
          onSubmit={(ev) => {
            ev.preventDefault();
            void act(() => api.attestJurisdiction({ body: { country } }));
          }}
        >
          <label className="text-sm">
            Country of residence (ISO code, e.g. DE)
            <input
              value={country}
              onChange={(ev) => setCountry(ev.target.value.slice(0, 2))}
              maxLength={2}
              className="mt-1 block w-24 rounded-sm border border-border bg-bg px-2 py-1.5 uppercase"
            />
          </label>
          <button className={btn} disabled={busy || country.length !== 2}>
            Confirm country
          </button>
        </form>
      )}

      {needDisclosures && (
        <div className={card}>
          <h2 className="font-medium">Risk disclosures</h2>
          <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-2 text-sm">
            {d.items.map((i) => (
              <section key={i.id}>
                <h3 className="font-medium">{i.title}</h3>
                <p className="text-muted">{i.body}</p>
              </section>
            ))}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(ev) => setAccepted(ev.target.checked)}
            />
            I have read and accept these risks
          </label>
          <button
            className={`${btn} mt-3`}
            disabled={busy || !accepted}
            onClick={() =>
              void act(() => api.acknowledgeDisclosures({ body: { version: d.version } }))
            }
          >
            Accept
          </button>
        </div>
      )}

      {blocked && (
        <EmptyState>
          The Vault is not available where you are. You can still compare prices and bet directly on
          the Venue.{' '}
          <Link href="/explore" className="underline">
            Explore Events
          </Link>
        </EmptyState>
      )}
      {err && <ErrorState message={err} />}
    </div>
  );
}
