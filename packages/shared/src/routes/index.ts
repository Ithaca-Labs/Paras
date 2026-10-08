import {
  getSiweNonce,
  verifySiwe,
  requestEmailCode,
  verifyEmailCode,
  logout,
  getMe,
} from './auth.js';
import { getEvent, listEvents, streamEventQuotes } from './events.js';
import { getHealth } from './health.js';
import {
  acknowledgeDisclosures,
  attestJurisdiction,
  getDisclosures,
  getVaultEligibility,
} from './jurisdiction.js';
import { createMagicLink, resolveMagicLink } from './magic-links.js';
import { getCategory, listCategories } from './taxonomy.js';
import { listVenues } from './venues.js';

/**
 * Every API route. Add new route files here; the api, OpenAPI document and typed client
 * all read from this object, keyed by operationId.
 */
export const apiRoutes = {
  getHealth,
  getSiweNonce,
  verifySiwe,
  requestEmailCode,
  verifyEmailCode,
  logout,
  getMe,
  listEvents,
  getEvent,
  createMagicLink,
  resolveMagicLink,
  listCategories,
  getCategory,
  listVenues,
  getDisclosures,
  acknowledgeDisclosures,
  attestJurisdiction,
  getVaultEligibility,
} as const;
/** Server-Sent Events routes (not callable through the JSON client). */
export const sseRoutes = { streamEventQuotes } as const;
export type ApiRoutes = typeof apiRoutes;

export * from './events.js';
export * from './health.js';
export * from './magic-links.js';
export * from './taxonomy.js';
export * from './auth.js';
export * from './venues.js';
export * from './jurisdiction.js';
