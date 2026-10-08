/**
 * Cross-Venue Event matching (pure). Venue-agnostic: works on question text, end date and
 * Outcome labels only. Pipeline per pair: embedding similarity (given) -> hard gates ->
 * confidence -> tier. Optional LLM verification is applied by the caller via {@link MatchVerifier}.
 */

export const MATCH = {
  /** At or above: auto-link. */
  AUTO: 0.85,
  /** At or above (and below AUTO): operator review queue. Below: separate Events. */
  REVIEW: 0.65,
  /** Auto-links below this carry the low-confidence warning (operator-confirmed links never do). */
  LOW_CONFIDENCE_BELOW: 0.93,
  /** Embedding candidates under this similarity are not even scored. */
  CANDIDATE_MIN_SIMILARITY: 0.5,
  /** Resolution dates further apart than this are different Events. */
  DATE_WINDOW_MS: 2 * 86_400_000,
} as const;

export type MatchTier = 'auto' | 'review' | 'separate';
export type GateFailure = 'date' | 'strike' | 'entity' | 'direction' | 'stage';

export interface MatchMarket {
  question: string;
  endDate: Date | null;
  /** Outcome labels in Venue order. */
  outcomes: readonly string[];
}

export interface MatchVerdict {
  tier: MatchTier;
  confidence: number;
  gates: GateFailure[];
  /** `inverse`: the guest's YES is the host's NO (negated wording). */
  direction: 'same' | 'inverse';
  /** Set when the host is multi-outcome and the guest is one binary Market per candidate. */
  candidate: string | null;
}

/** Optional second opinion (e.g. an LLM) on a pair that passed the gates. Implementations must be injectable. */
export interface MatchVerifier {
  verify(a: MatchMarket, b: MatchMarket): Promise<'same' | 'different' | 'unsure'>;
}

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_RE = new RegExp(`^(?:${MONTHS})$`, 'i');

const STOP_CAPS = new Set(
  'will who what when which does do is are can could should would how yes no before after by the in on at over under above below if or and for with to of a an this that'.split(
    ' ',
  ),
);
// shortcut: tiny alias table, extend as mismatches show up in the review queue.
const ALIASES: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  fed: 'federal',
  fomc: 'federal',
  reserve: 'federal',
  gop: 'republican',
  dems: 'democratic',
  democrat: 'democratic',
};

const UP =
  /\b(above|over|exceeds?|higher|more than|at least|greater|rises?|increases?|win|wins)\b/i;
const DOWN =
  /\b(below|under|lower|less than|at most|fewer|falls?|drops?|decreases?|dips?|lose|loses)\b/i;
const NEGATION = /\b(not|won't|wont|never|fails? to|no longer|without)\b/i;
const VERSUS = /\b(beats?|defeats?)\b/i;
const STAGES =
  /\b(primary|primaries|nominee|nomination|runoff|general election|semi-?finals?|quarter-?finals?|group stage|playoffs?|regular season|first round|second round|debate)\b/gi;

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const years = (q: string): Set<string> => new Set(q.match(/\b(?:19|20)\d{2}\b/g) ?? []);

/** Thresholds as canonical strings ("100000", "25%"). Years and calendar days are not thresholds. */
function strikes(question: string): Set<string> {
  const text = question
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b`, 'gi'), ' ');
  const out = new Set<string>();
  const re =
    /(\d[\d,]*(?:\.\d+)?)\s*(%|percent|bps|basis points|thousand|million|billion|bn|mm|k|m|b)?\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(raw)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === '%' || unit === 'percent') out.add(`${raw}%`);
    else if (unit === 'bps' || unit === 'basis points') out.add(`${raw / 100}%`);
    else out.add(String(raw * (SCALE[unit] ?? 1)));
  }
  return out;
}

/** Ordered capitalised names (lower-cased, aliased), ignoring question words and months. */
function entities(question: string, drop: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  for (const w of question.match(/\b[A-Z][A-Za-z]{1,}\b/g) ?? []) {
    const lower = w.toLowerCase();
    if (STOP_CAPS.has(lower) || MONTH_RE.test(w) || drop.has(lower)) continue;
    seen.add(ALIASES[lower] ?? lower);
  }
  // Lower-case aliases ("btc", "fed") still count when the text uses them.
  for (const w of question.toLowerCase().match(/[a-z]+/g) ?? []) {
    const canonical = ALIASES[w];
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}

const stages = (q: string): Set<string> =>
  new Set(
    (q.match(STAGES) ?? []).map((s) => s.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')),
  );

const setEq = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The candidate whose label appears (whole word) in a binary Market's question, if any. */
export function findCandidate(outcomes: readonly string[], question: string): string | null {
  const q = question.toLowerCase();
  const hits = outcomes.filter((o) => {
    const label = o.trim().toLowerCase();
    return label && new RegExp(`(?:^|[^a-z0-9])${escapeRe(label)}(?:$|[^a-z0-9])`).test(q);
  });
  return hits.length === 1 ? hits[0]! : null;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isBinary = (m: MatchMarket) => m.outcomes.length === 2;
/** One Market whose Outcomes are the candidates (3+, or 2 non-yes/no labels is treated as binary). */
const isMulti = (m: MatchMarket) => m.outcomes.length >= 3;

/** `inverse` when exactly one question is negated ("fail to cut" vs "cut"). */
export function pairDirection(hostQuestion: string, guestQuestion: string): 'same' | 'inverse' {
  return NEGATION.test(hostQuestion) !== NEGATION.test(guestQuestion) ? 'inverse' : 'same';
}

/**
 * Score one Market (guest) against the Market that represents an Event (host).
 * `similarity` is the embedding cosine of the two Events. Hard gates veto regardless of similarity.
 */
export function evaluatePair(
  host: MatchMarket,
  guest: MatchMarket,
  similarity: number,
): MatchVerdict {
  const separate = (gates: GateFailure[]): MatchVerdict => ({
    tier: 'separate',
    confidence: 0,
    gates,
    direction: 'same',
    candidate: null,
  });

  let candidate: string | null = null;
  if (isMulti(host) && isBinary(guest)) {
    candidate = findCandidate(host.outcomes, guest.question);
    if (!candidate) return separate(['entity']);
  } else if (isMulti(host) || isMulti(guest)) {
    return separate(['entity']); // shortcut: multi-outcome only pairs with its per-candidate binaries
  }

  const gates: GateFailure[] = [];
  const hq = host.question;
  const gq = guest.question;

  if (host.endDate && guest.endDate) {
    if (Math.abs(host.endDate.getTime() - guest.endDate.getTime()) > MATCH.DATE_WINDOW_MS) {
      gates.push('date');
    }
  }
  const hy = years(hq);
  const gy = years(gq);
  if (hy.size && gy.size && !setEq(hy, gy) && !gates.includes('date')) gates.push('date');

  const hs = strikes(hq);
  const gs = strikes(gq);
  // Thresholds must agree; one side naming a strike the other lacks is a different question.
  if (!setEq(hs, gs)) gates.push('strike');

  const drop = new Set(candidate ? candidate.toLowerCase().split(/\s+/) : []);
  const he = entities(hq);
  const ge = entities(gq, drop);
  if (he.length && ge.length) {
    const [small, big] = he.length <= ge.length ? [he, ge] : [ge, he];
    if (!small.every((e) => big.includes(e))) gates.push('entity');
  }

  const hUp = UP.test(hq);
  const hDown = DOWN.test(hq);
  const gUp = UP.test(gq);
  const gDown = DOWN.test(gq);
  const opposite = (hUp && !hDown && gDown && !gUp) || (hDown && !hUp && gUp && !gDown);
  const swappedSides =
    VERSUS.test(hq) &&
    VERSUS.test(gq) &&
    he.join() !== ge.join() &&
    setEq(new Set(he), new Set(ge));
  if (opposite || swappedSides) gates.push('direction');

  if (!setEq(stages(hq), stages(gq))) gates.push('stage');

  if (gates.length) return separate(gates);

  const direction = candidate ? 'same' : pairDirection(hq, gq);
  let confidence = similarity;
  if (hs.size && setEq(hs, gs)) confidence += 0.05;
  if (he.length && setEq(new Set(he), new Set(ge))) confidence += 0.03;
  if (direction === 'inverse') confidence -= 0.05;
  confidence = Math.min(1, Math.max(0, confidence));
  return { tier: tierOf(confidence), confidence, gates, direction, candidate };
}

export const tierOf = (confidence: number): MatchTier =>
  confidence >= MATCH.AUTO ? 'auto' : confidence >= MATCH.REVIEW ? 'review' : 'separate';

/** Apply a verifier's answer: `same` lifts confidence to at least AUTO, `different` vetoes. */
export function applyVerification(
  v: MatchVerdict,
  answer: 'same' | 'different' | 'unsure',
): MatchVerdict {
  if (answer === 'different')
    return { ...v, tier: 'separate', confidence: Math.min(v.confidence, MATCH.REVIEW - 0.01) };
  if (answer === 'same') {
    const confidence = Math.max(v.confidence, MATCH.AUTO);
    return { ...v, confidence, tier: tierOf(confidence) };
  }
  return v;
}

/** Warning for users: automatic link that is not rock solid. Operator-confirmed links are never low. */
export const isLowConfidence = (confidence: number, source: 'auto' | 'operator'): boolean =>
  source === 'auto' && confidence < MATCH.LOW_CONFIDENCE_BELOW;
