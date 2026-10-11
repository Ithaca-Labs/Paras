import type { Me } from '@paras/shared';
import { api } from './api';

/**
 * Exchange a Privy access token for a Paras API session (cookie).
 * STUB until #92 ships the API endpoint (planned `POST /v1/auth/privy`, not yet in
 * packages/shared). When it lands: add the route to shared, call `api.<op>({ body: { token } })` here,
 * delete the stub. This is the only function to change.
 */
export async function exchangePrivyToken(_accessToken: string): Promise<void> {
  // shortcut: no-op, so Privy login succeeds in the UI but the API session is not created, until #92.
}

/** Current API session User, or null when signed out / unreachable. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await api.getMe();
  } catch {
    return null;
  }
}

export async function endSession(): Promise<void> {
  await api.logout().catch(() => undefined);
}
