const PLAIN = /^\d+(\.\d+)?$/;

/**
 * Coerce a Venue-supplied number or numeric string into a plain decimal string
 * (no exponent, no sign). Returns `fallback` for missing, negative or non-numeric input.
 */
export function toDecimalString(value: unknown, fallback = '0'): string {
  if (typeof value === 'string' && PLAIN.test(value.trim())) return value.trim();
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  const s = String(n);
  return PLAIN.test(s) ? s : n.toFixed(9).replace(/\.?0+$/, '');
}
