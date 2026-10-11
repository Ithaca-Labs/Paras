'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { btnCls, Field, inputCls, SubmitStatus, useSubmit } from '@/lib/use-submit';

/** Limit buy: Paras places it through the delegated signer when the ask reaches the trigger. */
export function LimitOrderForm({ eventId, outcome }: { eventId: string; outcome: string }) {
  const [amount, setAmount] = useState('');
  const [triggerPrice, setTrigger] = useState('');
  const [hours, setHours] = useState('24');
  const { busy, error, note, run } = useSubmit();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.createOrder({
            body: {
              kind: 'limit_buy',
              eventId,
              outcome,
              amount,
              triggerPrice,
              expiresInHours: Number(hours),
            },
          });
          return 'Limit order created';
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
      <Field label="Buy when ask is at or below (0-1)">
        <input
          className={inputCls}
          inputMode="decimal"
          required
          value={triggerPrice}
          onChange={(e) => setTrigger(e.target.value)}
        />
      </Field>
      <Field label="Expires in (hours)">
        <input
          className={inputCls}
          type="number"
          min={1}
          max={720}
          required
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
      </Field>
      <button className={btnCls} disabled={busy}>
        {busy ? 'Creating…' : `Place limit order on ${outcome}`}
      </button>
      <SubmitStatus error={error} note={note} />
    </form>
  );
}
