import {
  getSiweNonce,
  verifySiwe,
  requestEmailCode,
  verifyEmailCode,
  logout,
  getMe,
} from './auth.js';
import { getHealth } from './health.js';

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
} as const;
export type ApiRoutes = typeof apiRoutes;

export * from './health.js';
export * from './auth.js';
