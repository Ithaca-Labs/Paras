import { describe, expect, it } from 'vitest';
import {
  computeSmartMoney,
  cryptoSymbol,
  detectAlerts,
  explainMarket,
  priceDirection,
  rankFeed,
  smartMoneyLeaning,
  type FeedCandidate,
} from '../src/index.js';

const h = (side: string, size: number, pnl: number) => ({
  side,
  position_size: size,
  current_price: 0.5,
  unrealized_pnl_usd: pnl,
});
const t = (action: string, side: string, usd: number) => ({
  taker_action: action,
  side,
  usdc_value: usd,
});

describe('computeSmartMoney', () => {
  it('leans YES when profitable holders and flow sit on YES; ignores losing holders', () => {
    const s = computeSmartMoney({
      holders: [h('Yes', 1000, 50), h('Yes', 500, 10), h('No', 400, 5), h('No', 9000, -100)],
      trades: [t('buy', 'Yes', 8000), t('sell', 'No', 2000)],
    });
    expect(s.smartHolders).toBe(3);
    expect(s.yesShare).toBeCloseTo(1500 / 1900);
    expect(s.flowUsd).toBe(10_000);
    expect(smartMoneyLeaning(s)).toBe('YES');
    expect(s.strength).toBeGreaterThan(0.5);
  });

  it('leans NO on the mirror and is neutral without data', () => {
    const no = computeSmartMoney({ holders: [h('No', 1000, 9)], trades: [t('buy', 'No', 5000)] });
    expect(smartMoneyLeaning(no)).toBe('NO');
    const none = computeSmartMoney({ holders: [], trades: [] });
    expect(none).toMatchObject({ lean: 0, yesShare: null });
    expect(smartMoneyLeaning(none)).toBe('neutral');
  });

  it('token netflow nudges in the direction the question implies', () => {
    const base = { holders: [], trades: [], netflow24hUsd: 2e6 };
    expect(computeSmartMoney({ ...base, netflowYesSign: 1 }).lean).toBeGreaterThan(0);
    expect(computeSmartMoney({ ...base, netflowYesSign: -1 }).lean).toBeLessThan(0);
  });

  it('parses crypto questions', () => {
    expect(cryptoSymbol('Will Bitcoin reach $150k?')).toBe('BTC');
    expect(cryptoSymbol('Will Monad hit $5?')).toBe('MON');
    expect(cryptoSymbol('Will the Fed cut?')).toBeNull();
    expect(priceDirection('Will ETH dip to 2000?')).toBe(-1);
    expect(priceDirection('Will ETH reach 5000?')).toBe(1);
  });
});

describe('smart money in Feed + alerts', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const cand = (id: string, sm: FeedCandidate['smartMoney']): FeedCandidate => ({
    id,
    volume: 1000,
    liquidity: 1000,
    move24h: 0,
    trendingScore: 0,
    endDate: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    tags: [],
    embedding: null,
    smartMoney: sm,
  });
  const input = (candidates: FeedCandidate[]) => ({
    candidates,
    profile: null,
    signals: [],
    follows: { events: new Set<string>(), tags: new Set<string>() },
    now,
  });

  it('ranks a strong lean above an otherwise identical Event, with reason text', () => {
    const ranked = rankFeed(input([cand('a', null), cand('b', { lean: -0.9, strength: 0.9 })]));
    expect(ranked.map((e) => e.eventId)).toEqual(['b', 'a']);
    expect(ranked[0]!.reason).toBe('Smart money is leaning NO');
  });

  it('ignores a weak lean', () => {
    const ranked = rankFeed(input([cand('a', null), cand('b', { lean: 0.1, strength: 0.1 })]));
    expect(ranked.map((e) => e.eventId)).toEqual(['a', 'b']);
  });

  it('alerts only on a strong lean, deduped per lean per day', () => {
    const e = { id: 'e1', title: 'T', move24h: 0, endDate: null };
    const thr = { moveThreshold: 0.1, closingWithinHours: 24 };
    expect(detectAlerts({ ...e, smartMoney: { lean: 0.3, strength: 0.3 } }, thr, now)).toEqual([]);
    const [a] = detectAlerts({ ...e, smartMoney: { lean: 0.8, strength: 0.8 } }, thr, now);
    expect(a).toMatchObject({ kind: 'smart_money', dedupeKey: 'smart:e1:YES:2026-10-11' });
    expect(a!.body).toContain('leaning YES');
  });

  it('explains a move with and without data', () => {
    expect(explainMarket({ title: 'T', move24h: 0.12, signal: null })).toContain('12 points');
    const signal = computeSmartMoney({ holders: [h('Yes', 100, 1)], trades: [] });
    expect(explainMarket({ title: 'T', move24h: 0, signal })).toContain('leaning YES');
  });
});
