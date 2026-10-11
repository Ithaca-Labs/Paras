'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-api';
import { DemoBanner } from './demo-banner';
import { ErrorState } from './states';
import { VaultFunds } from './vault-funds';
import { VaultGate } from './vault-gate';

/** Vault page body: gate (disclosures, country) -> balance, deposit/withdraw, Deposit Wallet. */
export function VaultApp() {
  const cfg = useLoad(() => api.getConfig());
  return (
    <>
      {cfg.data?.demoMode && <DemoBanner />}
      <VaultGate>
        {cfg.error ? (
          <ErrorState message={cfg.error} onRetry={cfg.reload} />
        ) : cfg.data?.vault ? (
          <>
            <VaultFunds vault={cfg.data.vault} />
            <p className="mt-4 text-sm text-muted">
              Positions, exits and history are in your{' '}
              <Link href="/portfolio" className="underline">
                Portfolio
              </Link>
              .
            </p>
          </>
        ) : (
          cfg.data && <ErrorState message="The Vault is not configured on this deployment." />
        )}
      </VaultGate>
    </>
  );
}
