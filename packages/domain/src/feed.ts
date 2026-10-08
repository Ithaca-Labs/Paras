import { cosine } from './embedding.js';
import { taxonomyNode } from './taxonomy.js';

export const SIGNAL_KINDS = ['view', 'dismiss', 'fewer_like_this', 'bet'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const FOLLOW_KINDS = ['event', 'topic', 'entity'] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];

/** Tunable Feed knobs. Component weights are relative; each component is scaled to 0..1 first. */
export interface FeedWeights {
  interest: number;
  trending: number;
  liquidity: number;
  freshness: number;
  /** Boost from a follow (Event, topic or entity). */
  follow: number;
  /** Boost/penalty from implicit signals (views, bets, fewer-like-this, dismissals). */
  signals: number;
  /** Subtracted per already-ranked item that shares the same primary tag. */
  diversity: number;
  /** Liquidity (USD) at which the liquidity component saturates. */
  liquidityFloor: number;
  /** Same, for beginner or conservative users; Events below it are also halved. */
  strictLiquidityFloor: number;
  freshnessHalfLifeDays: number;
  signalHalfLifeDays: number;
}

export const DEFAULT_FEED_WEIGHTS: FeedWeights = {
  interest: 1,
  trending: 0.5,
  liquidity: 0.2,
  freshness: 0.15,
  follow: 1.5,
  signals: 0.4,
  diversity: 0.15,
  liquidityFloor: 500,
  strictLiquidityFloor: 2000,
  freshnessHalfLifeDays: 3,
  signalHalfLifeDays: 7,
};

export interface FeedCandidate {
  id: string;
  /** USD. */
  volume: number;
  liquidity: number;
  move24h: number;
  trendingScore: number;
  endDate: Date | null;
  createdAt: Date;
  /** Taxonomy tag ids (category, topics, entities). */
  tags: readonly string[];
  embedding: readonly number[] | null;
}

export interface FeedProfile {
  embedding: readonly number[] | null;
  /** Picked taxonomy ids (categories, topics and entities together). */
  picks: readonly string[];
  experience: string | null;
  riskAppetite: string | null;
}

export interface FeedSignal {
  eventId: string;
  kind: SignalKind;
  at: Date;
  /** Tags of the signalled Event. */
  tags: readonly string[];
}

export interface FeedFollows {
  events: ReadonlySet<string>;
  /** Taxonomy ids (topic or entity follows). */
  tags: ReadonlySet<string>;
}

export interface FeedInput {
  candidates: readonly FeedCandidate[];
  profile: FeedProfile | null;
  signals: readonly FeedSignal[];
  follows: FeedFollows;
  now: Date;
  weights?: Partial<FeedWeights>;
}

export interface FeedEntry {
  eventId: string;
  score: number;
  reason: string;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const label = (id: string) => taxonomyNode(id)?.label ?? id;
/** Impact of one signal before decay. Dismissals also hide the Event itself. */
const SIGNAL_WEIGHT: Record<SignalKind, number> = {
  view: 0.3,
  bet: 1,
  fewer_like_this: -1,
  dismiss: -0.4,
};
/** Dismissed or "fewer like this" Events stay hidden while the decayed signal is above this. */
const HIDE_ABOVE = 0.25;

const isStrict = (p: FeedProfile | null) =>
  p?.experience === 'beginner' || p?.riskAppetite === 'conservative';

/**
 * Deterministic Feed ranking. Score = weighted blend of interest similarity (popularity when there
 * is no profile), trending, a liquidity floor (stricter for beginner/conservative users),
 * freshness, follows and implicit signals; a diversity penalty is applied greedily while ranking.
 * Resolved/closed filtering is the caller's job. Pure: `now` is injected.
 */
export function rankFeed(input: FeedInput): FeedEntry[] {
  const w = { ...DEFAULT_FEED_WEIGHTS, ...input.weights };
  const { candidates, profile, follows, now } = input;
  const strict = isStrict(profile);
  const floor = strict ? w.strictLiquidityFloor : w.liquidityFloor;
  const personalized = !!profile && (!!profile.embedding || profile.picks.length > 0);
  const maxTrend = Math.max(1e-9, ...candidates.map((c) => c.trendingScore));
  const maxVol = Math.max(1e-9, ...candidates.map((c) => Math.log10(1 + c.volume)));

  // Decayed signal strength per tag.
  const hidden = hiddenEventIds(input.signals, now, w.signalHalfLifeDays);
  const tagAffinity = new Map<string, number>();
  for (const s of input.signals) {
    const decay = 0.5 ** ((now.getTime() - s.at.getTime()) / (w.signalHalfLifeDays * DAY));
    const v = SIGNAL_WEIGHT[s.kind] * decay;
    for (const t of s.tags) tagAffinity.set(t, (tagAffinity.get(t) ?? 0) + v);
  }

  const pool = candidates.filter((c) => !hidden.has(c.id));
  const scored = pool.map((c) => {
    const picked = profile?.picks.filter((p) => c.tags.includes(p)) ?? [];
    const cos =
      profile?.embedding && c.embedding ? clamp01(cosine(profile.embedding, c.embedding)) : null;
    const tagMatch = picked.length ? 1 : 0;
    const interest = personalized
      ? cos === null
        ? tagMatch
        : 0.6 * cos + 0.4 * tagMatch
      : Math.log10(1 + c.volume) / maxVol; // no profile: popularity
    const trend = clamp01(c.trendingScore / maxTrend);
    const liq = clamp01(c.liquidity / floor);
    const age = (now.getTime() - c.createdAt.getTime()) / DAY;
    const fresh = 0.5 ** (Math.max(0, age) / w.freshnessHalfLifeDays);
    const followedTags = c.tags.filter((t) => follows.tags.has(t));
    const followed = follows.events.has(c.id) ? 1 : followedTags.length ? 0.8 : 0;
    const aff = c.tags.reduce((sum, t) => sum + (tagAffinity.get(t) ?? 0), 0);
    const sig = Math.tanh(aff);

    const parts = {
      follow: w.follow * followed,
      interest: w.interest * interest,
      signals: w.signals * sig,
      trending: w.trending * trend,
      freshness: w.freshness * fresh,
      liquidity: w.liquidity * liq,
    };
    let base = Object.values(parts).reduce((a, b) => a + b, 0);
    if (strict && c.liquidity < floor) base *= 0.5;

    // Personal reasons win when they carry real weight; otherwise name the biggest component.
    const personal: (keyof typeof parts)[] = [
      'follow',
      'signals',
      ...(personalized ? (['interest'] as const) : []),
    ];
    const bestOf = (keys: (keyof typeof parts)[]) =>
      keys.reduce((a, b) => (parts[b] > parts[a] ? b : a));
    const bestPersonal = bestOf(personal);
    const top =
      parts[bestPersonal] >= 0.15
        ? bestPersonal
        : bestOf(Object.keys(parts) as (keyof typeof parts)[]);
    let reason: string;
    const closing = c.endDate && c.endDate > now && c.endDate.getTime() - now.getTime() <= WEEK;
    if (top === 'follow') {
      reason = follows.events.has(c.id)
        ? 'Because you follow this Event'
        : `Because you follow ${label(followedTags[0]!)}`;
    } else if (top === 'interest') {
      reason = !personalized
        ? 'Popular on Paras'
        : picked.length
          ? `Matches your interest in ${label(picked[0]!)}`
          : 'Similar to your interests';
    } else if (top === 'signals') {
      reason = sig > 0 ? 'Similar to Events you viewed or bet on' : 'Related to your activity';
    } else if (top === 'trending') {
      reason =
        c.move24h >= 0.05
          ? `Price moved ${Math.round(c.move24h * 100)} points in 24h`
          : closing
            ? 'Closing soon'
            : 'Trending now';
    } else if (top === 'freshness') reason = 'New on Paras';
    else reason = 'Deep liquidity';
    return { c, base, reason };
  });

  // Greedy pick with a diversity penalty per already-ranked item sharing the primary tag.
  const primary = (c: FeedCandidate) => c.tags[0] ?? '';
  const taken = new Map<string, number>();
  const out: FeedEntry[] = [];
  const left = [...scored];
  while (left.length) {
    let best = 0;
    let bestScore = -Infinity;
    left.forEach((s, i) => {
      const score = s.base - w.diversity * (taken.get(primary(s.c)) ?? 0);
      if (score > bestScore || (score === bestScore && s.c.id < left[best]!.c.id)) {
        best = i;
        bestScore = score;
      }
    });
    const [s] = left.splice(best, 1);
    taken.set(primary(s!.c), (taken.get(primary(s!.c)) ?? 0) + 1);
    out.push({ eventId: s!.c.id, score: Math.round(bestScore * 1e4) / 1e4, reason: s!.reason });
  }
  return out;
}

/**
 * Starter picks for newcomers: calm, liquid Events (the strict liquidity floor), most popular first.
 */
export function beginnerPicks(
  candidates: readonly FeedCandidate[],
  hidden: ReadonlySet<string>,
  weights: Partial<FeedWeights> = {},
  limit = 5,
): FeedEntry[] {
  const w = { ...DEFAULT_FEED_WEIGHTS, ...weights };
  return candidates
    .filter((c) => !hidden.has(c.id) && c.liquidity >= w.strictLiquidityFloor && c.move24h <= 0.1)
    .sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((c) => ({
      eventId: c.id,
      score: Math.log10(1 + c.volume),
      reason: 'Deep liquidity and a steady price: easy to get in and out',
    }));
}

/** Ids hidden from the Feed by a still-fresh dismissal or "fewer like this". */
export function hiddenEventIds(
  signals: readonly Pick<FeedSignal, 'eventId' | 'kind' | 'at'>[],
  now: Date,
  halfLifeDays = DEFAULT_FEED_WEIGHTS.signalHalfLifeDays,
): Set<string> {
  return new Set(
    signals
      .filter(
        (s) =>
          (s.kind === 'dismiss' || s.kind === 'fewer_like_this') &&
          0.5 ** ((now.getTime() - s.at.getTime()) / (halfLifeDays * DAY)) > HIDE_ABOVE,
      )
      .map((s) => s.eventId),
  );
}
