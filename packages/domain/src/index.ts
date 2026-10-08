// Pure business logic only: no I/O, no clocks, no randomness unless injected.
export { quoteSpread, type SpreadInput } from './quote.js';
export {
  normalizeEmail,
  sanitizeReturnTo,
  pickMergeSurvivor,
  type MergeCandidate,
} from './identity.js';
