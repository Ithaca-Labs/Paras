import type { ExplainView, SmartMoneyView } from '@paras/shared';
import { usd } from '@/lib/format';

const tone = { YES: 'text-positive', NO: 'text-negative', neutral: 'text-muted' } as const;

/** Nansen smart-money read plus the plain-language "Why is this moving?" summary. */
export function SmartMoneyPanel({
  smartMoney,
  explain,
}: {
  smartMoney: SmartMoneyView | null;
  explain: ExplainView | null;
}) {
  return (
    <section
      aria-labelledby="sm-h"
      className="relative flex flex-col gap-4 overflow-hidden rounded-card border border-border bg-surface p-6"
    >
      <h2 id="sm-h" className="text-2xl">
        Why is this moving?
      </h2>
      <p className="max-w-prose border-l-2 border-gold pl-4 font-display text-[1.05rem] leading-relaxed">
        {explain?.summary ?? 'No explanation available yet.'}
      </p>
      {smartMoney ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-surface-2/50 p-4 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Smart money leans</dt>
          <dd className={`font-medium ${tone[smartMoney.leaning]}`}>
            {smartMoney.leaning} ({Math.round(smartMoney.strength * 100)}%)
          </dd>
          <dt className="text-muted">Smart holders</dt>
          <dd>{smartMoney.smartHolders}</dd>
          {smartMoney.yesShare != null && (
            <>
              <dt className="text-muted">Holder value on YES</dt>
              <dd>{Math.round(smartMoney.yesShare * 100)}%</dd>
            </>
          )}
          <dt className="text-muted">Recent flow</dt>
          <dd>
            {usd(String(Math.abs(smartMoney.flowUsd)))} toward{' '}
            {smartMoney.flowUsd >= 0 ? 'YES' : 'NO'}
          </dd>
          <dd className="col-span-2 text-xs text-muted">{smartMoney.reason} · via Nansen</dd>
        </dl>
      ) : (
        <p className="text-xs text-muted">No smart-money signal for this Event.</p>
      )}
    </section>
  );
}
