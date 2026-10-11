'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { btnCls, Field, inputCls, SubmitStatus, useSubmit } from '@/lib/use-submit';

/** Bet now through the Privy delegated signer. The User picks Event, Outcome, amount and max price. */
export function OneClickBet({ eventId, outcome }: { eventId: string; outcome: string }) {
  const [amount, setAmount] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const { busy, error, note, run } = useSubmit();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api.oneClickBet({ body: { eventId, outcome, amount, maxPrice } });
          return `Bet submitted (Intent ${r.intentId.slice(0, 8)})`;
        });
      }}
    >
      <Field label="Amount (USDC)">
        <input
          className={inputCls}
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Max price (0-1)">
        <input
          className={inputCls}
          inputMode="decimal"
          required
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
      </Field>
      <button className={btnCls} disabled={busy}>
        {busy ? 'Placing…' : `One-click bet on ${outcome}`}
      </button>
      <SubmitStatus error={error} note={note} />
    </form>
  );
}
