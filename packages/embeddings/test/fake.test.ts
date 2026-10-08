import { EMBEDDING_DIMENSIONS, cosine } from '@paras/domain';
import { describe, expect, it } from 'vitest';
import { createFakeEmbedder } from '../src/index.js';

describe('fake embedder', () => {
  it('is deterministic, unit-length and 384-wide', async () => {
    const e = createFakeEmbedder();
    const [a, b] = await e.embed(['Will the Fed cut rates?', 'Will the Fed cut rates?']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(cosine(a!, a!)).toBeCloseTo(1);
  });

  it('puts synonyms close and unrelated text far', async () => {
    const [q, near, far] = await createFakeEmbedder().embed([
      'will the Fed cut',
      'FOMC lowers',
      'Lakers championship parade',
    ]);
    expect(cosine(q!, near!)).toBeGreaterThan(0.9);
    expect(cosine(q!, far!)).toBeLessThan(0.1);
  });
});
