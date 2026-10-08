import { defineRoute } from '../route.js';
import { z } from '../zod.js';

/** Relative path only; the api drops anything else. Echoed back on verify. */
const returnTo = z.string().max(2048).optional();

/** `cookie` (default): httpOnly cookie, token not in body. `bearer`: no cookie, token in body. */
const sessionMode = z.enum(['cookie', 'bearer']).default('cookie');

export const Me = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  emails: z.array(z.string()),
  wallets: z.array(z.object({ address: z.string(), chainId: z.number().int() })),
});
export type Me = z.infer<typeof Me>;

export const AuthResult = z.object({
  user: Me,
  /** Bearer token; only present when `session: 'bearer'`. */
  token: z.string().nullable(),
  expiresAt: z.string(),
  /** True when this call linked/merged identities into an existing signed-in User. */
  linked: z.boolean(),
  /** True when a second existing User was absorbed by the link. */
  merged: z.boolean(),
  /** Sanitized `returnTo` supplied when the flow started, else null. */
  returnTo: z.string().nullable(),
});
export type AuthResult = z.infer<typeof AuthResult>;

const Ok = z.object({ ok: z.literal(true) });

export const getSiweNonce = defineRoute({
  method: 'get',
  path: '/v1/auth/siwe/nonce',
  operationId: 'getSiweNonce',
  summary: 'Issue a single-use SIWE nonce',
  tags: ['auth'],
  request: { query: z.object({ returnTo }) },
  response: z.object({ nonce: z.string(), expiresAt: z.string() }),
});

export const verifySiwe = defineRoute({
  method: 'post',
  path: '/v1/auth/siwe/verify',
  operationId: 'verifySiwe',
  summary: 'Verify an EIP-4361 message; sign in, or link the wallet if already signed in',
  tags: ['auth'],
  request: {
    body: z.object({ message: z.string(), signature: z.string(), session: sessionMode }),
  },
  response: AuthResult,
});

export const requestEmailCode = defineRoute({
  method: 'post',
  path: '/v1/auth/email/request',
  operationId: 'requestEmailCode',
  summary: 'Email a one-time sign-in code (always answers ok; rate limited)',
  tags: ['auth'],
  request: { body: z.object({ email: z.string().max(254), returnTo }) },
  response: Ok,
});

export const verifyEmailCode = defineRoute({
  method: 'post',
  path: '/v1/auth/email/verify',
  operationId: 'verifyEmailCode',
  summary: 'Verify an emailed code; sign in, or link the email if already signed in',
  tags: ['auth'],
  request: {
    body: z.object({
      email: z.string().max(254),
      code: z.string().min(1).max(16),
      session: sessionMode,
    }),
  },
  response: AuthResult,
});

export const logout = defineRoute({
  method: 'post',
  path: '/v1/auth/logout',
  operationId: 'logout',
  summary: 'Revoke the current session and clear the cookie',
  tags: ['auth'],
  request: {},
  response: Ok,
});

export const getMe = defineRoute({
  method: 'get',
  path: '/v1/me',
  operationId: 'getMe',
  summary: 'The signed-in User (401 if not signed in)',
  tags: ['auth'],
  request: {},
  response: Me,
});
