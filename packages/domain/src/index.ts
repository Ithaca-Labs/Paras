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
export {
  POLYMARKET_RESTRICTED,
  vaultIneligibleReasons,
  venueAvailability,
  venueAvailabilityFor,
  type Availability,
  type IneligibleReason,
  type VaultEligibilityInput,
  type VenueRestrictions,
} from './eligibility.js';
export { RISK_DISCLOSURES } from './disclosures.js';
export {
  alignSeries,
  feePerShare,
  midSpread,
  pickBest,
  priceQuote,
  walkAsks,
  type Candidate,
  type FeeModel,
  type Fill,
  type PricedQuote,
  type QuoteInput,
} from './compare.js';
export {
  POLYMARKET_ROUTE_OVERHEAD_BPS,
  computeRoute,
  fillWithinMaxPrice,
  type RedirectHint,
  type RoutedFill,
  type RouteResult,
  type RouteVenue,
} from './route.js';
export {
  INTENT_STATUSES,
  TERMINAL_INTENT_STATUSES,
  intentDetailsHash,
  intentTypedData,
  registerTypedData,
  type IntentDetails,
  type IntentStatus,
} from './intent.js';
export {
  MATCH,
  applyVerification,
  evaluatePair,
  findCandidate,
  isLowConfidence,
  pairDirection,
  tierOf,
  type GateFailure,
  type MatchMarket,
  type MatchTier,
  type MatchVerdict,
  type MatchVerifier,
} from './matching.js';
export {
  DECIMAL_SCALE,
  divDecimal,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  type Scaled,
} from './decimal.js';
export {
  EXPERIENCE_LEVELS,
  HORIZONS,
  RISK_APPETITES,
  STAKE_SIZES,
  explainerFor,
  profileVector,
  type ExperienceLevel,
  type ExplainerSection,
  type ProfileSelection,
} from './profile.js';
export {
  DEFAULT_FEED_WEIGHTS,
  FOLLOW_KINDS,
  SIGNAL_KINDS,
  beginnerPicks,
  hiddenEventIds,
  rankFeed,
  type FeedCandidate,
  type FeedEntry,
  type FeedFollows,
  type FeedInput,
  type FeedProfile,
  type FeedSignal,
  type FeedWeights,
  type FollowKind,
  type SignalKind,
} from './feed.js';
export {
  ALERT_KINDS,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_KINDS,
  deliveryChannels,
  detectAlerts,
  digestPicks,
  weekKey,
  type AlertDraft,
  type AlertEvent,
  type AlertThresholds,
  type NotificationFrequency,
  type NotificationKind,
  type NotificationPrefs,
} from './notifications.js';
export {
  OAUTH_SCOPES,
  parseScopes,
  pkceMatches,
  redirectUriMatches,
  validRedirectUri,
  type OAuthScope,
} from './oauth.js';
