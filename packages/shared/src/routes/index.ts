import {
  getSiweNonce,
  verifySiwe,
  requestEmailCode,
  verifyEmailCode,
  logout,
  getMe,
} from './auth.js';
import {
  approveMatchReview,
  listMatchReviews,
  mergeEvents,
  rejectMatchReview,
  splitEvent,
  updateEventLabels,
} from './admin.js';
import { compareEvent, getEventHistory } from './compare.js';
import { getEvent, listEvents, streamEventQuotes } from './events.js';
import { addFollow, getFeed, listFollows, recordFeedSignal, removeFollow } from './feed.js';
import { getHealth } from './health.js';
import {
  getNotificationPrefs,
  listNotifications,
  markNotificationsRead,
  updateNotificationPrefs,
} from './notifications.js';
import {
  acknowledgeDisclosures,
  attestJurisdiction,
  getDisclosures,
  getVaultEligibility,
} from './jurisdiction.js';
import { exitPosition, getPortfolio, listHistory, setPositionReturn } from './portfolio.js';
import { createMagicLink, resolveMagicLink } from './magic-links.js';
import {
  authorizeOAuth,
  getOAuthClient,
  getTokenInfo,
  listConnectedApps,
  revokeConnectedApp,
} from './oauth.js';
import {
  getExplainer,
  getOnboardingOptions,
  getProfile,
  interpretInterest,
  resetProfile,
  skipOnboarding,
  updateProfile,
} from './profile.js';
import { getCategory, listCategories } from './taxonomy.js';
import { getPauses, getVenueHealth, pauseExecutor, unpauseExecutor } from './ops.js';
import { listVenues } from './venues.js';
import {
  getDepositWallet,
  getIntent,
  getVaultBalances,
  previewIntent,
  requestDepositWallet,
} from './vault.js';

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
  compareEvent,
  getEventHistory,
  createMagicLink,
  resolveMagicLink,
  listCategories,
  getCategory,
  listVenues,
  listMatchReviews,
  approveMatchReview,
  rejectMatchReview,
  mergeEvents,
  splitEvent,
  updateEventLabels,
  getDisclosures,
  acknowledgeDisclosures,
  attestJurisdiction,
  getVaultEligibility,
  getProfile,
  updateProfile,
  skipOnboarding,
  resetProfile,
  getOnboardingOptions,
  interpretInterest,
  getExplainer,
  getVaultBalances,
  previewIntent,
  getIntent,
  getDepositWallet,
  requestDepositWallet,
  getPortfolio,
  listHistory,
  exitPosition,
  setPositionReturn,
  getFeed,
  recordFeedSignal,
  listFollows,
  addFollow,
  removeFollow,
  listNotifications,
  markNotificationsRead,
  getNotificationPrefs,
  updateNotificationPrefs,
  getOAuthClient,
  authorizeOAuth,
  getTokenInfo,
  listConnectedApps,
  revokeConnectedApp,
  getVenueHealth,
  getPauses,
  pauseExecutor,
  unpauseExecutor,
} as const;
/** Server-Sent Events routes (not callable through the JSON client). */
export const sseRoutes = { streamEventQuotes } as const;
export type ApiRoutes = typeof apiRoutes;

export * from './admin.js';
export * from './events.js';
export * from './compare.js';
export * from './health.js';
export * from './magic-links.js';
export * from './taxonomy.js';
export * from './profile.js';
export * from './feed.js';
export * from './notifications.js';
export * from './auth.js';
export * from './venues.js';
export * from './jurisdiction.js';
export * from './vault.js';
export * from './portfolio.js';
export * from './oauth.js';
export * from './ops.js';
