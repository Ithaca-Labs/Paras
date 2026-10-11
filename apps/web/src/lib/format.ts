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
