/**
 * Reciprocal-rank fusion: merge several ranked id lists into one score per id.
 * `score = sum(1 / (k + rank))`, rank starting at 1. Higher is better; k=60 is the usual default.
 * Used to blend full-text and semantic search; the Feed (#12) can reuse it for its own blends.
 */
export function reciprocalRankFusion(
  rankings: readonly (readonly string[])[],
  k = 60,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return out;
}

export interface TrendingInput {
  /** Total traded volume, USD. */
  volume: number;
  /** Largest absolute price change of any Outcome over 24h, in 0..1 price units. */
  move24h: number;
  endDate: Date | null;
  now: Date;
}

const CLOSING_SOON_MS = 7 * 24 * 3600_000;

/**
 * Heuristic "trending" score: log volume, amplified by recent price movement and a bump for
 * Events resolving within a week. No volume history exists yet, so volume is lifetime volume;
 * swap in a volume delta here when Quote/volume snapshots land. Pure; tune weights here only.
 */
export function trendingScore({ volume, move24h, endDate, now }: TrendingInput): number {
  const size = Math.log10(1 + Math.max(0, volume));
  const heat = 1 + 8 * Math.min(1, Math.max(0, move24h));
  const closing =
    endDate && endDate > now && endDate.getTime() - now.getTime() <= CLOSING_SOON_MS ? 1.25 : 1;
  return size * heat * closing;
}
