/**
 * Exact decimal arithmetic on string amounts. Money and prices are never floats: values are
 * parsed into bigint at 1e9 scale (extra fractional digits are truncated), combined, and
 * formatted back to a plain decimal string.
 */
export const DECIMAL_SCALE = 9;
const ONE = 10n ** BigInt(DECIMAL_SCALE);
const PATTERN = /^(\d+)(?:\.(\d+))?$/;

export type Scaled = bigint;

/** Parse a non-negative decimal string like "0.52" into a scaled bigint. Throws on bad input. */
export function parseDecimal(value: string): Scaled {
  const m = PATTERN.exec(value);
  if (!m) throw new RangeError(`invalid decimal: ${JSON.stringify(value)}`);
  const frac = (m[2] ?? '').slice(0, DECIMAL_SCALE).padEnd(DECIMAL_SCALE, '0');
  return BigInt(m[1]!) * ONE + BigInt(frac);
}

/** Format a scaled bigint as a decimal string without trailing zeros ("0.52", "10"). */
export function formatDecimal(value: Scaled): string {
  const whole = value / ONE;
  const frac = (value % ONE).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** a * b, truncated toward zero at the shared scale. */
export const mulDecimal = (a: Scaled, b: Scaled): Scaled => (a * b) / ONE;
