'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { btnCls, Field, inputCls, SubmitStatus, useSubmit } from '@/lib/use-submit';
import { useSession } from './providers';

type DepositToken = Awaited<ReturnType<typeof api.listDepositTokens>>['items'][number];
type Quote = Awaited<ReturnType<typeof api.quoteDeposit>>;

/** Aurora / NEAR Intents any-chain USDC deposit. Renders nothing unless /v1/config enables it. */
export function AnyChainDeposit() {
  const { user } = useSession();
  const [tokens, setTokens] = useState<DepositToken[] | null>(null);
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    api
      .getConfig()
      .then((c) => (c.features.anyChainDeposit ? api.listDepositTokens() : null))
      .then((r) => {
        setTokens(r?.items ?? null);
        setAsset(r?.items[0]?.assetId ?? '');
      })
      .catch(() => undefined);
  }, []);

  // Poll the swap while a deposit address is open.
  const depositAddress = quote?.depositAddress;
  useEffect(() => {
    if (!depositAddress) return;
    const t = setInterval(
      () =>
        api.getDepositStatus({ query: { depositAddress } }).then(
          (s) => setStatus(s.status),
          () => undefined,
        ),
      10_000,
    );
    return () => clearInterval(t);
  }, [depositAddress]);

  const recipient = user?.wallets[0]?.address.toLowerCase();
  if (!tokens || !recipient) return null;
  const token = tokens.find((t) => t.assetId === asset);
  return (
    <section className="mt-6 grid max-w-xl gap-3 rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold">Deposit from any chain</h2>
      <p className="text-sm text-muted">
        Swap USDC from another chain into your Monad wallet. This is a separate step: once it lands,
        deposit to the Vault.
      </p>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const base = BigInt(Math.round(Number(amount) * 10 ** (token?.decimals ?? 6)));
            setStatus(null);
            setQuote(
              await api.quoteDeposit({
                body: {
                  originAsset: asset,
                  amount: base.toString(),
                  refundTo,
                  recipient,
                  dry: false,
                },
              }),
            );
          });
        }}
      >
        <Field label="From">
          <select className={inputCls} value={asset} onChange={(e) => setAsset(e.target.value)}>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol} on {t.blockchain}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            className={inputCls}
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Refund address on that chain">
          <input
            className={inputCls}
            required
            value={refundTo}
            onChange={(e) => setRefundTo(e.target.value)}
          />
        </Field>
        <button className={btnCls} disabled={busy}>
          {busy ? 'Quoting…' : 'Get deposit address'}
        </button>
      </form>
      <SubmitStatus error={error} note={null} />
      {quote?.depositAddress && (
        <div className="grid gap-1 text-sm">
          <p>
            Send {amount} {token?.symbol} to{' '}
            <code className="break-all">{quote.depositAddress}</code>
            {quote.depositMemo && <> (memo {quote.depositMemo})</>}
          </p>
          <p className="text-muted">Status: {status ?? 'waiting for deposit'}</p>
        </div>
      )}
    </section>
  );
}
