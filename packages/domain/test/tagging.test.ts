import { describe, expect, it } from 'vitest';
import {
  TAXONOMY,
  buildTaxonomyIndex,
  reciprocalRankFusion,
  tagEvent,
  trendingScore,
  type Embedder,
} from '../src/index.js';

// Keyword-only: no vectors involved, so any embedder will do.
const noEmbedder: Embedder = { dimensions: 1, embed: async (t) => t.map(() => [1]) };
const index = await buildTaxonomyIndex(noEmbedder);
const tag = (title: string, description = '', venueLabels: string[] = []) =>
  tagEvent({ title, description, venueLabels }, index);

describe('taxonomy', () => {
  it('has unique ids and valid parents', () => {
    const ids = new Set(TAXONOMY.map((n) => n.id));
    expect(ids.size).toBe(TAXONOMY.length);
    for (const n of TAXONOMY) {
      if (n.kind === 'category') expect(n.parent).toBeUndefined();
      else expect(ids.has(n.parent!)).toBe(true);
    }
  });
});

describe('tagEvent', () => {
  it('tags entity, topic and category from the title', () => {
    const r = tag('Will LeBron James retire after the Lakers season?');
    expect(r.category).toBe('sports');
    expect(r.tags.map((t) => t.id)).toEqual(expect.arrayContaining(['lakers', 'nba', 'sports']));
  });

  it('uses Venue categories', () => {
    expect(tag('Something obscure', '', ['Crypto']).category).toBe('crypto');
  });

  it('matches whole words only', () => {
    expect(tag('Will the airline sue?').tags.map((t) => t.id)).not.toContain('ai-models');
  });

  it('returns no category when nothing matches', () => {
    expect(tag('Will it happen?')).toEqual({ tags: [], category: null });
  });
});

describe('ranking', () => {
  it('fuses rankings, rewarding agreement', () => {
    const s = reciprocalRankFusion([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect([...s].sort((x, y) => y[1] - x[1]).map(([id]) => id)).toEqual(['b', 'a', 'c']);
  });

  it('boosts price movement and imminent close', () => {
    const now = new Date('2026-10-09T00:00:00Z');
    const base = { volume: 10_000, move24h: 0, endDate: null, now };
    expect(trendingScore({ ...base, move24h: 0.2 })).toBeGreaterThan(trendingScore(base));
    expect(trendingScore({ ...base, endDate: new Date('2026-10-10T00:00:00Z') })).toBeGreaterThan(
      trendingScore(base),
    );
  });
});
