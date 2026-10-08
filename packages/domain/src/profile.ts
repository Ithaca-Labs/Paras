import { meanVector } from './embedding.js';
import type { TaxonomyIndex } from './taxonomy.js';

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const RISK_APPETITES = ['conservative', 'balanced', 'aggressive'] as const;
/** Typical stake per bet: small < $25, medium $25-250, large > $250. */
export const STAKE_SIZES = ['small', 'medium', 'large'] as const;
/** When the user wants Markets to settle. */
export const HORIZONS = ['week', 'month', 'long', 'any'] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export interface ProfileSelection {
  categories: readonly string[];
  topics: readonly string[];
  entities: readonly string[];
}

/** More specific picks pull the profile vector harder than broad ones. */
const WEIGHT = { category: 1, topic: 2, entity: 3, freeText: 3 } as const;

/**
 * The Interest Profile as one unit vector: weighted mean of the picked taxonomy node vectors and
 * the embedded free-text interests. The Feed (#12) ranks by `cosine(profileVector, event.embedding)`.
 * Null when nothing was picked.
 */
export function profileVector(
  index: TaxonomyIndex,
  sel: ProfileSelection,
  freeTextVectors: readonly (readonly number[])[],
): number[] | null {
  const vectors: (readonly number[])[] = [];
  const weights: number[] = [];
  const add = (ids: readonly string[], w: number) => {
    for (const id of ids) {
      const v = index.vectors.get(id);
      if (v) {
        vectors.push(v);
        weights.push(w);
      }
    }
  };
  add(sel.categories, WEIGHT.category);
  add(sel.topics, WEIGHT.topic);
  add(sel.entities, WEIGHT.entity);
  for (const v of freeTextVectors) {
    vectors.push(v);
    weights.push(WEIGHT.freeText);
  }
  return vectors.length ? meanVector(vectors, weights) : null;
}

export interface ExplainerSection {
  id: string;
  title: string;
  body: string;
}

const PRICE = {
  id: 'price',
  title: 'Prices are probabilities',
  body: 'Each Outcome trades between $0 and $1. A price of $0.62 means the market thinks that Outcome has about a 62% chance.',
};
const PAYOUT = {
  id: 'payout',
  title: 'How payouts work',
  body: 'A share pays $1 if its Outcome happens and $0 if not. Buy at $0.62 and you profit $0.38 per share if right, and lose the $0.62 if wrong.',
};
const VENUES = {
  id: 'venues',
  title: 'Why compare Venues',
  body: 'The same Event trades on several Venues at different prices. Paras shows the best price per Outcome so you can see the spread.',
};
const SPREAD = {
  id: 'spread',
  title: 'Spread, depth and fees',
  body: 'The gap between best bid and ask is your hidden cost. Thin books move against you on size, so check liquidity, and compare prices after Venue fees.',
};
const RESOLUTION = {
  id: 'resolution',
  title: 'Resolution rules differ',
  body: 'Equivalent Events can resolve on different sources or edge cases. Read each Venue rule before treating two prices as the same bet.',
};
const RISK = {
  id: 'risk',
  title: 'Risk basics',
  body: 'Long-shots are cheap but usually lose. Never stake more than you can lose, and avoid illiquid Markets where you cannot exit.',
};

/** Onboarding explainer, deeper and shorter as experience grows. Pure static content. */
export function explainerFor(level: ExperienceLevel): ExplainerSection[] {
  switch (level) {
    case 'beginner':
      return [PRICE, PAYOUT, RISK, VENUES];
    case 'intermediate':
      return [PAYOUT, VENUES, SPREAD];
    case 'advanced':
      return [SPREAD, RESOLUTION];
  }
}
