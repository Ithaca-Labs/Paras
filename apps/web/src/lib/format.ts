/** Display-only formatting. No domain logic here (that lives in the API / packages/domain). */

/** "0.42" -> "42¢" */
export const cents = (price: string | null | undefined) =>
  price == null ? '—' : `${Math.round(Number(price) * 100)}¢`;

/** "1234567.8" -> "$1.2M" */
export const usd = (v: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(v));

/** "0.4213" -> "$0.421" (per-share amounts). */
export const perShare = (v: string | null | undefined) =>
  v == null ? '—' : `$${Number(v).toFixed(3)}`;

/** "0.0513" -> "5.1¢" (spreads, fees). */
export const centsPrecise = (v: string | null | undefined) =>
  v == null ? '—' : `${(Number(v) * 100).toFixed(1)}¢`;

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
