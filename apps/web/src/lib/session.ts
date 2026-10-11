import type { Me } from '@paras/shared';
import { api } from './api';

/** Exchange Privy access + identity tokens for a Paras API session (cookie). */
export async function exchangePrivyToken(
  accessToken: string,
  identityToken: string,
): Promise<void> {
  await api.privyLogin({ body: { accessToken, identityToken, session: 'cookie' } });
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
