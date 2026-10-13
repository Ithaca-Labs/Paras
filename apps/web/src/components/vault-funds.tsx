'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { errMsg, useLoad } from '@/lib/use-api';
import { useVaultWallet } from '@/lib/use-vault-wallet';
import { erc20Abi, publicClient, toUsdc, txUrl, validAmount, vaultAbi } from '@/lib/vault-chain';
import { ErrorState } from './states';

const card = 'rounded-card border border-border bg-surface p-5';
const btn =
  'rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';
const input = 'w-40 rounded-sm border border-border bg-bg px-2 py-1.5 text-sm';

type Vault = { address: string; usdc: string };

/** Balance breakdown + deposit/withdraw (viem via the Privy wallet) + Deposit Wallet setup. */
export function VaultFunds({ vault }: { vault: Vault }) {
  const bal = useLoad(() => api.getVaultBalances());
  const b = bal.data?.total;
  return (
    <div className="space-y-4">
      <section className={card} aria-label="Balance">
        <h2 className="font-medium">Balance (USDC)</h2>
        {bal.error ? (
          <ErrorState message={bal.error} onRetry={bal.reload} />
        ) : (
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ['Idle', b?.idle, 'withdrawable or bettable'],
                ['Reserved', b?.reserved, 'locked behind a signed Intent'],
                ['In flight', b?.inFlight, 'bridging to your Deposit Wallet'],
              ] as const
            ).map(([k, v, hint]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{v ?? '—'}</dd>
                <dd className="text-xs text-muted">{hint}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <MoveFunds vault={vault} onDone={bal.reload} />
      <DepositWallet />
    </div>
  );
}

function MoveFunds({ vault, onDone }: { vault: Vault; onDone: () => void }) {
  const { address, client } = useVaultWallet();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'deposit' | 'withdraw' | null>(null);
  const [step, setStep] = useState('');
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const vaultAddr = vault.address as `0x${string}`;
  const usdc = vault.usdc as `0x${string}`;

  const run = async (kind: 'deposit' | 'withdraw') => {
    if (!address) return;
    setBusy(kind);
    setErr(null);
    setTx(null);
    try {
      const wallet = await client();
      const value = toUsdc(amount);
      if (kind === 'deposit') {
        const have = await publicClient.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, vaultAddr],
        });
        if (have < value) {
          setStep('Approving USDC…');
          const h = await wallet.writeContract({
            address: usdc,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddr, value],
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
        }
      }
      setStep(kind === 'deposit' ? 'Depositing…' : 'Withdrawing…');
      const hash = await wallet.writeContract({
        address: vaultAddr,
        abi: vaultAbi,
        functionName: kind,
        args: [value],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setTx(hash);
      setAmount('');
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
      setStep('');
    }
  };

  return (
    <section className={card} aria-label="Deposit or withdraw">
      <h2 className="font-medium">Deposit / withdraw</h2>
      <p className="mt-1 text-xs text-muted">
        Wallet {address ?? 'not connected'}. Needs testnet USDC and MON for gas.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="Amount in USDC"
          inputMode="decimal"
          placeholder="Amount (USDC)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={input}
        />
        <button
          className={btn}
          disabled={!!busy || !address || !validAmount(amount)}
          onClick={() => void run('deposit')}
        >
          Deposit
        </button>
        <button
          className={btn}
          disabled={!!busy || !address || !validAmount(amount)}
          onClick={() => void run('withdraw')}
        >
          Withdraw
        </button>
        <span className="text-sm text-muted">{step}</span>
      </div>
      {tx && (
        <p className="mt-2 text-sm text-positive">
          Done.{' '}
          <a className="underline" href={txUrl(tx)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-negative">
          {err}
        </p>
      )}
    </section>
  );
}

const WALLET_STEP: Record<string, string> = {
  none: 'No Deposit Wallet yet.',
  requested: 'Deposit Wallet requested. Being deployed…',
  deployed: 'Deposit Wallet deployed. Sign to register it.',
  registered: 'Deposit Wallet ready.',
};

function DepositWallet() {
  const { address, client } = useVaultWallet();
  const dw = useLoad(() => api.getDepositWallet());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = dw.data;

  const act = async (sign: boolean) => {
    if (!address || !s) return;
    setBusy(true);
    setErr(null);
    try {
      let signature: `0x${string}` | undefined;
      if (sign && s.registerTypedData) {
        const wallet = await client();
        signature = await wallet.signTypedData({
          account: address,
          ...s.registerTypedData,
        } as never);
      }
      await api.requestDepositWallet({ body: { owner: s.owner ?? address, signature } });
      dw.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-label="Deposit Wallet">
      <h2 className="font-medium">Deposit Wallet</h2>
      {dw.error ? (
        <ErrorState message={dw.error} onRetry={dw.reload} />
      ) : (
        s && (
          <>
            <p className="mt-1 text-sm text-muted">{WALLET_STEP[s.status]}</p>
            {s.wallet && <p className="mt-1 break-all font-mono text-xs">{s.wallet}</p>}
            {s.status === 'none' && (
              <button
                className={`${btn} mt-3`}
                disabled={busy || !address}
                onClick={() => void act(false)}
              >
                Request Deposit Wallet
              </button>
            )}
            {s.status === 'deployed' && !s.signatureReceived && (
              <button className={`${btn} mt-3`} disabled={busy} onClick={() => void act(true)}>
                Sign registration
              </button>
            )}
            {s.status !== 'none' && s.status !== 'registered' && (
              <button className="ml-3 text-sm underline" onClick={dw.reload}>
                Refresh
              </button>
            )}
          </>
        )
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-negative">
          {err}
        </p>
      )}
    </section>
  );
}
