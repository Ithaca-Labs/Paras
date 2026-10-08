export interface SpreadInput {
  /** Best bid, 0..1 */
  bid: number;
  /** Best ask, 0..1 */
  ask: number;
}

/** Bid/ask spread of a Quote. Throws on a crossed or out-of-range book. */
export function quoteSpread({ bid, ask }: SpreadInput): number {
  if (bid < 0 || ask > 1 || bid > ask) throw new RangeError(`invalid book: bid=${bid} ask=${ask}`);
  return Number((ask - bid).toFixed(10));
}
