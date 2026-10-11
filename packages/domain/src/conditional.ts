/**
 * Conditional orders (#93): trigger rules. The User picks the Event, Outcome, amount and trigger;
 * nothing here chooses a trade. A trigger fires at most once: the caller claims the order
 * (`open` to `triggered`) atomically before acting.
 */

export const CONDITIONAL_KINDS = ['limit_buy', 'take_profit', 'stop_loss'] as const;
export type ConditionalKind = (typeof CONDITIONAL_KINDS)[number];

export const CONDITIONAL_STATUSES = [
  'open',
  'triggered',
  'placed',
  'cancelled',
  'expired',
  'failed',
] as const;
export type ConditionalStatus = (typeof CONDITIONAL_STATUSES)[number];

export interface TriggerQuote {
  /** Best bid (what a sale gets) and best ask (what a buy pays), 0..1; null = no such side. */
  bid: number | null;
  ask: number | null;
}

/**
 * limit_buy fires when the ask is at or below the trigger; take_profit when the bid is at or above
 * it; stop_loss when the bid is at or below it. A missing side never fires.
 */
export function shouldTrigger(kind: ConditionalKind, trigger: number, q: TriggerQuote): boolean {
  switch (kind) {
    case 'limit_buy':
      return q.ask !== null && q.ask <= trigger;
    case 'take_profit':
      return q.bid !== null && q.bid >= trigger;
    case 'stop_loss':
      return q.bid !== null && q.bid <= trigger;
  }
}

/**
 * Take-profit and stop-loss must sit on the far side of the current bid, else they would fire the
 * moment they are created (that is a plain sell). Limit buys may be marketable on purpose.
 * Returns the error, or null.
 */
export function validateTrigger(
  kind: ConditionalKind,
  trigger: number,
  q: TriggerQuote,
): string | null {
  if (!(trigger > 0 && trigger <= 1)) return 'trigger must be in (0, 1]';
  if ((kind === 'take_profit' || kind === 'stop_loss') && shouldTrigger(kind, trigger, q))
    return 'would_trigger_now';
  return null;
}
