import { describe, expect, it } from 'vitest';
import {
  MATCH,
  applyVerification,
  evaluatePair,
  isLowConfidence,
  type MatchMarket,
} from '../src/matching.js';

const m = (question: string, endDate = '2026-12-18', outcomes = ['Yes', 'No']): MatchMarket => ({
  question,
  endDate: new Date(endDate),
  outcomes,
});

describe('evaluatePair gates', () => {
  it('passes equivalent wording and aliases', () => {
    const v = evaluatePair(
      m('Will Bitcoin reach $100,000 by Dec 31?', '2026-12-31'),
      m('Will BTC hit $100k by December 31?', '2026-12-31'),
      0.9,
    );
    expect(v.gates).toEqual([]);
    expect(v.tier).toBe('auto');
  });

  it('vetoes opposite-direction wording even with perfect similarity', () => {
    const v = evaluatePair(
      m('Will Bitcoin be above $100k on Dec 31?'),
      m('Will Bitcoin be below $100k on Dec 31?'),
      1,
    );
    expect(v.gates).toContain('direction');
    expect(v.tier).toBe('separate');
  });

  it('vetoes swapped sides of a head-to-head', () => {
    const v = evaluatePair(m('Will Lakers beat Celtics?'), m('Will Celtics beat Lakers?'), 1);
    expect(v.gates).toContain('direction');
  });

  it('vetoes different resolution dates and years', () => {
    const q = 'Will the Fed cut rates?';
    expect(evaluatePair(m(q, '2026-12-18'), m(q, '2027-03-18'), 1).gates).toContain('date');
    expect(
      evaluatePair(m('Will the Fed cut rates in 2026?'), m('Will the Fed cut rates in 2027?'), 1)
        .gates,
    ).toContain('date');
  });

  it('vetoes different strikes, units and a missing strike', () => {
    expect(
      evaluatePair(m('Will Bitcoin reach $100k?'), m('Will Bitcoin reach $150k?'), 1).gates,
    ).toContain('strike');
    expect(
      evaluatePair(m('Will the Fed cut by 25 bps?'), m('Will the Fed cut by 50 bps?'), 1).gates,
    ).toContain('strike');
    expect(
      evaluatePair(m('Will Bitcoin reach $100k?'), m('Will Bitcoin rally?'), 1).gates,
    ).toContain('strike');
  });

  it('vetoes different entities and stages', () => {
    expect(
      evaluatePair(m('Will Alice win the election?'), m('Will Bob win the election?'), 1).gates,
    ).toContain('entity');
    expect(
      evaluatePair(
        m('Will Alice win the Republican nomination?'),
        m('Will Alice win the Republican general election?'),
        1,
      ).gates,
    ).toContain('stage');
  });

  it('ignores calendar days when comparing strikes', () => {
    expect(
      evaluatePair(m('Will the Fed cut rates on December 18?'), m('Fed cuts rates Dec 18'), 0.9)
        .gates,
    ).toEqual([]);
  });
});

describe('tiers and direction', () => {
  const a = m('Will the Fed cut rates in December?');
  const b = m('Fed rate cut at December meeting?');
  it('tiers by confidence', () => {
    expect(evaluatePair(a, a, 0.9).tier).toBe('auto');
    expect(evaluatePair(a, b, 0.7).tier).toBe('review');
    expect(evaluatePair(a, b, 0.5).tier).toBe('separate');
  });

  it('negated wording links inverse with a confidence penalty', () => {
    const v = evaluatePair(a, m('Will the Fed fail to cut rates in December?'), 0.95);
    expect(v.direction).toBe('inverse');
    expect(v.confidence).toBeLessThan(0.95);
  });

  it('multi-outcome host takes per-candidate binaries with the candidate set', () => {
    const host = m('Who will win the election?', '2026-12-18', ['Alice', 'Bob', 'Carol']);
    const v = evaluatePair(host, m('Will Alice win the election?'), 0.9);
    expect(v).toMatchObject({ candidate: 'Alice', direction: 'same', tier: 'auto' });
    expect(evaluatePair(host, m('Will Dave win the election?'), 0.9).tier).toBe('separate');
  });

  it('verifier lifts or vetoes', () => {
    const v = evaluatePair(a, b, 0.7);
    expect(applyVerification(v, 'same').tier).toBe('auto');
    expect(applyVerification(v, 'different').tier).toBe('separate');
    expect(applyVerification(v, 'unsure').tier).toBe('review');
  });

  it('low-confidence flag spares operator links', () => {
    expect(isLowConfidence(MATCH.AUTO, 'auto')).toBe(true);
    expect(isLowConfidence(0.99, 'auto')).toBe(false);
    expect(isLowConfidence(MATCH.AUTO, 'operator')).toBe(false);
  });
});
