'use client';

import type { PortfolioPosition } from '@paras/shared';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { errMsg, useLoad } from '@/lib/use-api';
import { useVaultWallet } from '@/lib/use-vault-wallet';
import { toUsdc } from '@/lib/vault-chain';
import { DemoBanner } from './demo-banner';
import { HistoryList } from './history-list';
import { TpSlForm } from './tp-sl-form';
import { EmptyState, ErrorState } from './states';
import { VaultGate } from './vault-gate';

const card = 'rounded-card border border-border bg-surface p-5';
const btn =
  'rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';
const pnlClass = (v: string) =>
  Number(v) < 0 ? 'text-negative' : Number(v) > 0 ? 'text-positive' : '';

/** `positionExtras(position)` renders below each row: #109 mounts TP/SL there. */
export function PortfolioView({
  positionExtras,
}: {
  positionExtras?: (p: PortfolioPosition) => ReactNode;
}) {
  const cfg = useLoad(() => api.getConfig());
  return (
    <>
      {cfg.data?.demoMode && <DemoBanner />}
      <VaultGate>
        <Positions extras={positionExtras} />
        <h2 className="mb-3 mt-8 text-lg font-semibold">History</h2>
        <HistoryList />
      </VaultGate>
    </>
  );
}

function Positions({ extras }: { extras?: (p: PortfolioPosition) => ReactNode }) {
  const pf = useLoad(() => api.getPortfolio());
  if (pf.error) return <ErrorState message={pf.error} onRetry={pf.reload} />;
  if (!pf.data) return <div className="h-32 animate-pulse rounded-card bg-surface-2" />;
  const t = pf.data.totals;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {(
          [
            ['Value', t.value],
            ['Cost', t.costBasis],
            ['Unrealized P&L', t.unrealizedPnl],
            ['Realized P&L', t.realizedPnl],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className={card}>
            <dt className="text-muted">{k}</dt>
            <dd
              className={`text-xl font-semibold tabular-nums ${k.includes('P&L') ? pnlClass(v) : ''}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {Number(pf.data.collateral.pusd) > 0 && (
        <p className="text-sm text-muted">
          {pf.data.collateral.pusd} pUSD waiting in your Deposit Wallet on Polygon.
        </p>
      )}
      {pf.data.positions.length === 0 ? (
        <EmptyState>No positions yet. Place a bet from an Event page.</EmptyState>
      ) : (
        pf.data.positions.map((p) => (
          <Position key={p.id} p={p} onChange={pf.reload}>
            {p.status === 'open' && <TpSlForm positionId={p.id} />}
            {extras?.(p)}
          </Position>
        ))
      )}
    </div>
  );
}

function Position({
  p,
  onChange,
  children,
}: {
  p: PortfolioPosition;
  onChange: () => void;
  children?: ReactNode;
}) {
  const { address, client } = useVaultWallet();
  const [minPrice, setMinPrice] = useState(
    p.price ? Math.max(0.01, Number(p.price) - 0.05).toFixed(2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = p.exit && !['done', 'failed'].includes(p.exit.status);
  const price = Number(minPrice);

  const exit = async () => {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const wallet = await client();
      const deadline = Math.floor(Date.now() / 1000) + 540; // API max is 10 min
      const signature = await wallet.signTypedData({
        account: address,
        domain: { name: 'Paras', version: '1' },
        types: {
          Exit: [
            { name: 'user', type: 'address' },
            { name: 'positionId', type: 'string' },
            { name: 'shares', type: 'uint256' },
            { name: 'minPrice', type: 'string' },
            { name: 'returnTo', type: 'string' },
            { name: 'deadline', type: 'uint64' },
          ],
        },
        primaryType: 'Exit',
        message: {
          user: address,
          positionId: p.id,
          shares: toUsdc(p.shares),
          minPrice,
          returnTo: p.returnTo,
          deadline: BigInt(deadline),
        },
      });
      await api.exitPosition({
        params: { id: p.id },
        body: { minPrice, returnTo: p.returnTo, deadline, signature },
      });
      onChange();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setReturn = async (returnTo: 'vault' | 'polygon') => {
    try {
      await api.setPositionReturn({ params: { id: p.id }, body: { returnTo } });
      onChange();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <article className={card}>
      <h3 className="font-medium">{p.question}</h3>
      <p className="text-sm text-muted">
        {p.outcome} on {p.venueId} · {p.shares} shares @ {p.avgCost}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Value</dt>
          <dd className="tabular-nums">{p.value}</dd>
        </div>
        <div>
          <dt className="text-muted">Best bid</dt>
          <dd className="tabular-nums">{p.price ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Unrealized</dt>
          <dd className={`tabular-nums ${pnlClass(p.unrealizedPnl)}`}>{p.unrealizedPnl}</dd>
        </div>
        <div>
          <dt className="text-muted">Realized</dt>
          <dd className={`tabular-nums ${pnlClass(p.realizedPnl)}`}>{p.realizedPnl}</dd>
        </div>
      </dl>
      {p.resolution.state !== 'open' && (
        <p className={`mt-2 text-sm ${p.resolution.delayed ? 'text-warning' : 'text-muted'}`}>
          Market {p.resolution.state}
          {p.resolution.delayed && ': resolution is delayed or disputed'}.
        </p>
      )}
      {p.exit && (
        <p
          className={`mt-2 text-sm ${p.exit.status === 'failed' ? 'text-negative' : 'text-muted'}`}
        >
          {p.exit.kind === 'redeem' ? 'Redemption' : 'Exit'}: {p.exit.status}
          {p.exit.reason ? ` (${p.exit.reason})` : ''}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Return proceeds to
          <select
            className="ml-2 rounded-sm border border-border bg-bg px-2 py-1"
            value={p.returnTo}
            onChange={(e) => void setReturn(e.target.value as 'vault' | 'polygon')}
          >
            <option value="vault">Vault (Monad)</option>
            <option value="polygon">Deposit Wallet (Polygon)</option>
          </select>
        </label>
        {p.status === 'open' && p.resolution.state !== 'resolved' && (
          <>
            <label className="text-sm">
              Min price
              <input
                aria-label="Minimum exit price"
                className="ml-2 w-20 rounded-sm border border-border bg-bg px-2 py-1"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
            </label>
            <button
              className={btn}
              disabled={busy || !!live || !(price > 0 && price < 1)}
              onClick={exit}
            >
              Exit (sign)
            </button>
          </>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-negative">
          {err}
        </p>
      )}
      {children}
    </article>
  );
}
