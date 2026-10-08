// Pure business logic only: no I/O, no clocks, no randomness unless injected.
export { quoteSpread, type SpreadInput } from './quote.js';
export {
  normalizeEmail,
  sanitizeReturnTo,
  pickMergeSurvivor,
  type MergeCandidate,
} from './identity.js';
export { bookToQuote, isStale, type BookInput, type BookLevel, type BookQuote } from './book.js';
export {
  signMagicLink,
  verifyMagicLink,
  type MagicLinkClaims,
  type MagicLinkKeys,
  type MagicLinkSource,
  type MagicLinkVerdict,
} from './magic-link.js';
export { venueLabel, type VenueLabel, type VenueLabelInput } from './venue-label.js';
export { DECIMAL_SCALE, formatDecimal, mulDecimal, parseDecimal, type Scaled } from './decimal.js';
export {
  EMBEDDING_DIMENSIONS,
  cosine,
  dot,
  eventEmbeddingText,
  meanVector,
  normalize,
  type Embedder,
} from './embedding.js';
export {
  TAXONOMY,
  buildTaxonomyIndex,
  keywordMatcher,
  nearestNodes,
  nodeEmbeddingText,
  taxonomyCategories,
  taxonomyChildren,
  taxonomyNode,
  type TagKind,
  type TaxonomyIndex,
  type TaxonomyNode,
} from './taxonomy.js';
export {
  DEFAULT_TAGGING,
  tagEvent,
  type EventTag,
  type TagSource,
  type TaggingInput,
  type TaggingOptions,
  type TaggingResult,
} from './tagging.js';
export { reciprocalRankFusion, trendingScore, type TrendingInput } from './ranking.js';
