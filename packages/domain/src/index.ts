// Pure business logic only: no I/O, no clocks, no randomness unless injected.
export { quoteSpread, type SpreadInput } from './quote.js';
export {
  normalizeEmail,
  sanitizeReturnTo,
  pickMergeSurvivor,
  type MergeCandidate,
} from './identity.js';
export { bookToQuote, isStale, type BookInput, type BookLevel, type BookQuote } from './book.js';
export { DECIMAL_SCALE, formatDecimal, mulDecimal, parseDecimal, type Scaled } from './decimal.js';
