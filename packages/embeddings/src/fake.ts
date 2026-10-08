import { EMBEDDING_DIMENSIONS, normalize, type Embedder } from '@paras/domain';

/**
 * Words that mean the same thing share a concept. The fake embedder maps every word to its
 * concept, so "FOMC lowers rates" and "will the Fed cut" overlap even with no shared word.
 * Extend per test via `createFakeEmbedder({ synonyms })`.
 */
export const DEFAULT_SYNONYMS: Record<string, readonly string[]> = {
  fed: ['fed', 'fomc', 'federal', 'reserve', 'powell'],
  cut: ['cut', 'cuts', 'lower', 'lowers', 'lowering', 'reduce', 'slash', 'ease', 'trim'],
  rate: ['rate', 'rates', 'borrowing', 'interest'],
  bitcoin: ['bitcoin', 'btc'],
  price: ['price', 'cost', 'costs', 'value'],
  win: ['win', 'wins', 'victory', 'champion', 'title'],
};

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was will with'.split(
    ' ',
  ),
);

const fnv = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export interface FakeEmbedderOptions {
  /** Extra concept groups: concept -> words. Merged over {@link DEFAULT_SYNONYMS}. */
  synonyms?: Record<string, readonly string[]>;
  dimensions?: number;
}

/**
 * Deterministic, offline stand-in for a sentence model: bag of concepts hashed into a fixed-size
 * unit vector. Texts sharing concepts get high cosine; unrelated texts get ~0. Never downloads
 * anything, so CI and unit tests use it wherever an `Embedder` is injected.
 */
export function createFakeEmbedder({
  synonyms = {},
  dimensions = EMBEDDING_DIMENSIONS,
}: FakeEmbedderOptions = {}): Embedder {
  const concept = new Map<string, string>();
  for (const [name, words] of Object.entries({ ...DEFAULT_SYNONYMS, ...synonyms })) {
    for (const w of words) concept.set(w, name);
  }
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(dimensions).fill(0);
    for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (STOPWORDS.has(raw)) continue;
      const c = concept.get(raw) ?? raw;
      v[fnv(c) % dimensions]! += 1;
    }
    return normalize(v);
  };
  return { dimensions, embed: async (texts) => texts.map(embedOne) };
}
