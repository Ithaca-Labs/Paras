'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { btnCls, Field, inputCls, SubmitStatus, useSubmit } from '@/lib/use-submit';

/** Take-profit / stop-loss on a position. Stop-loss needs a worst price at or below the trigger. */
export function TpSlForm({ positionId }: { positionId: string }) {
  const [kind, setKind] = useState<'take_profit' | 'stop_loss'>('take_profit');
  const [triggerPrice, setTrigger] = useState('');
  const [limitPrice, setLimit] = useState('');
  const [shares, setShares] = useState('');
  const { busy, error, note, run } = useSubmit();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.createOrder({
            body: {
              kind,
              positionId,
              triggerPrice,
              ...(limitPrice && { limitPrice }),
              ...(shares && { shares }),
              expiresInHours: 24 * 30,
            },
          });
          return kind === 'take_profit' ? 'Take-profit set' : 'Stop-loss set';
        });
      }}
    >
      <Field label="Type">
        <select
          className={inputCls}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="take_profit">Take-profit (sell when bid rises to trigger)</option>
          <option value="stop_loss">Stop-loss (sell when bid falls to trigger)</option>
        </select>
      </Field>
      <Field label="Trigger price (0-1)">
        <input
          className={inputCls}
          inputMode="decimal"
          required
          value={triggerPrice}
          onChange={(e) => setTrigger(e.target.value)}
        />
      </Field>
      <Field
        label={
          kind === 'stop_loss'
            ? 'Worst price (required, at or below trigger)'
            : 'Worst price (optional)'
        }
      >
        <input
          className={inputCls}
          inputMode="decimal"
          required={kind === 'stop_loss'}
          value={limitPrice}
          onChange={(e) => setLimit(e.target.value)}
        />
      </Field>
      <Field label="Shares (blank = all)">
        <input
          className={inputCls}
          inputMode="decimal"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
        />
      </Field>
      <button className={btnCls} disabled={busy}>
        {busy ? 'Saving…' : 'Set order'}
      </button>
      <SubmitStatus error={error} note={note} />
    </form>
  );
}
