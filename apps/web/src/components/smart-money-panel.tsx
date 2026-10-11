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
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="sm-h" className="text-lg font-medium">
        Why is this moving?
      </h2>
      <p className="text-sm">{explain?.summary ?? 'No explanation available yet.'}</p>
      {smartMoney ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
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
