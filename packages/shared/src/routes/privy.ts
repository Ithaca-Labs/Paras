import { defineRoute } from '../route.js';
import { DecimalString } from '../venue.js';
import { z } from '../zod.js';
import { AuthResult } from './auth.js';

export const privyLogin = defineRoute({
  method: 'post',
  path: '/v1/auth/privy',
  operationId: 'privyLogin',
  summary:
    "Sign in (or link, if already signed in) with a Privy access + identity token. The Privy embedded wallet becomes a linked wallet (the User's Vault account). 503 if Privy is not configured; 400 if the Privy user has no embedded Ethereum wallet",
  tags: ['privy'],
  request: {
    body: z.object({
      accessToken: z.string().min(1).max(8192),
      identityToken: z.string().min(1).max(8192),
      session: z.enum(['cookie', 'bearer']).default('cookie'),
    }),
  },
  response: AuthResult,
});

export const Delegation = z.object({
  status: z.enum(['none', 'pending', 'active', 'revoked']),
  wallet: z.string().nullable(),
  /** Privy key-quorum id of Paras's signer: pass to the client's addSessionSigners with `policyIds`. */
  signerId: z.string().nullable(),
  policyIds: z.array(z.string()),
  /** USDC decimals. */
  maxIntent: z.string().nullable(),
  cap: z.string().nullable(),
  spent: z.string().nullable(),
});
export type Delegation = z.infer<typeof Delegation>;

export const getDelegation = defineRoute({
  method: 'get',
  path: '/v1/delegation',
  operationId: 'getDelegation',
  summary: "The caller's Privy delegation (Paras's session signer) status and spend",
  tags: ['privy'],
  request: {},
  response: Delegation,
});

export const grantDelegation = defineRoute({
  method: 'post',
  path: '/v1/delegation',
  operationId: 'grantDelegation',
  summary:
    "Create the Privy policy (Vault only; Intent/Exit signing and submit/cancel only; per-Intent max) and record a pending delegation. The client then calls Privy's addSessionSigners({ signerId, policyIds }) and confirms. Replaces a revoked or pending delegation",
  tags: ['privy'],
  request: {
    body: z.object({
      /** Max USDC for a single Intent. */
      maxIntent: DecimalString,
      /** Max USDC over the delegation's life. */
      cap: DecimalString,
    }),
  },
  response: Delegation,
});

export const confirmDelegation = defineRoute({
  method: 'post',
  path: '/v1/delegation/confirm',
  operationId: 'confirmDelegation',
  summary:
    "Check at Privy that Paras's signer is registered on the wallet and activate the delegation (409 delegation_not_registered otherwise)",
  tags: ['privy'],
  request: {},
  response: Delegation,
});

export const revokeDelegation = defineRoute({
  method: 'post',
  path: '/v1/delegation/revoke',
  operationId: 'revokeDelegation',
  summary:
    "Stop Paras acting for the caller: takes effect at once on Paras's side. The client should also call Privy's removeSessionSigners",
  tags: ['privy'],
  request: {},
  response: Delegation,
});
