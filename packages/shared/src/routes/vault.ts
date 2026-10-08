import { defineRoute } from '../route.js';
import { DecimalString } from '../venue.js';
import { z } from '../zod.js';

const Address = z.string().regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x address');

/** USDC amounts as decimal strings (6 decimals). */
export const VaultBalance = z.object({
  /** Funds the User can withdraw or reserve. */
  idle: DecimalString,
  /** Locked behind a signed Intent that has not been dispatched. */
  reserved: DecimalString,
  /** Burned via CCTP toward the Deposit Wallet and not yet returned. */
  inFlight: DecimalString,
});

export const VaultBalances = z.object({
  /** Vault proxy on Monad. */
  vault: Address,
  chainId: z.number().int(),
  total: VaultBalance,
  /** One entry per wallet linked to the User (the Vault account is keyed by the depositing address). */
  accounts: z.array(VaultBalance.extend({ address: Address, depositWallet: Address.nullable() })),
});
export type VaultBalances = z.infer<typeof VaultBalances>;

export const getVaultBalances = defineRoute({
  method: 'get',
  path: '/v1/vault/balance',
  operationId: 'getVaultBalances',
  summary:
    "Vault balance breakdown (idle, reserved, in-flight) read from Monad for the signed-in User's linked wallets. 503 vault_unavailable if the chain is not configured",
  tags: ['vault'],
  request: {},
  response: VaultBalances,
});

// ---------------------------------------------------------------- Intents (#20)

const Hex32 = z.string().regex(/^0x[0-9a-f]{64}$/, 'bytes32 hex');
const IntentStatus = z.enum([
  'previewed',
  'signed',
  'dispatched',
  'bridging',
  'bridged',
  'ordering',
  'returning',
  'filled',
  'partially_filled',
  'failed',
  'expired',
  'cancelled',
]);

export const IntentPreviewRequest = z.object({
  eventId: z.string().uuid(),
  /** Venue-agnostic Outcome label of the Event, e.g. "Yes". */
  outcome: z.string().min(1),
  /** The linked wallet that signs the Intent and owns the Vault account. */
  user: Address,
  /** USDC to spend, decimal string. */
  amount: DecimalString,
  /** Worst price per share (before fees), 0..1. */
  maxPrice: DecimalString,
  /** `return` (default): unfilled remainder goes back to the Vault at once. `rest`: leave a resting order until expiry. */
  remainder: z.enum(['rest', 'return']).default('return'),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});

const PreviewFill = z.object({
  shares: DecimalString,
  avgPrice: DecimalString,
  fees: DecimalString,
  /** Bridge + swap cost (about 1 bps), already deducted from the stake before the fill. */
  overhead: DecimalString,
  spent: DecimalString,
  effectivePrice: DecimalString,
  unspent: DecimalString,
});

const Redirect = z.object({
  venueId: z.string(),
  redirectUrl: z.string().url(),
  shares: DecimalString.nullable(),
  effectivePrice: DecimalString.nullable(),
});

const TypedDomain = z.object({
  name: z.string(),
  version: z.string(),
  chainId: z.number().int(),
  verifyingContract: Address,
});
const TypedTypes = z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() })));

/** EIP-712 typed data for `Vault.submitIntent`. `amount` and `expiry` are decimal strings: convert with BigInt before signing. */
const IntentTypedData = z.object({
  domain: TypedDomain,
  types: TypedTypes,
  primaryType: z.literal('Intent'),
  message: z.object({
    user: Address,
    id: Hex32,
    amount: z.string(),
    expiry: z.string(),
    detailsHash: Hex32,
  }),
});

export const IntentPreview = z.object({
  /** Why the User cannot place this bet via the Vault (eligibility, wallet, balance). Empty = can sign. */
  blockers: z.array(z.string()),
  route: z
    .object({
      venueId: z.string(),
      marketId: z.string().uuid(),
      outcomeId: z.string().uuid(),
      maxPrice: DecimalString,
      expected: PreviewFill,
    })
    .nullable(),
  /** Set instead of `route` when nothing can be bought within the limits. */
  noRoute: z
    .object({
      reason: z.enum(['no_routable_venue', 'max_price', 'no_depth']),
      redirects: z.array(Redirect),
    })
    .nullable(),
  /** A read-only Venue (Kalshi) would buy more shares for the same stake: offer the redirect. */
  hint: z
    .object({
      venueId: z.string(),
      redirectUrl: z.string().url(),
      shares: DecimalString,
      effectivePrice: DecimalString,
      extraShares: DecimalString,
    })
    .nullable(),
  /** Present when the User can sign: the Intent row to poll and the typed data to sign. */
  intent: z
    .object({
      id: z.string().uuid(),
      expiresAt: z.iso.datetime(),
      detailsHash: Hex32,
      typedData: IntentTypedData,
    })
    .nullable(),
});
export type IntentPreview = z.infer<typeof IntentPreview>;

export const previewIntent = defineRoute({
  method: 'post',
  path: '/v1/vault/intents/preview',
  operationId: 'previewIntent',
  summary:
    'Pre-sign Intent preview: best Route, expected fill/fees/shares, a Kalshi redirect hint when it is cheaper, and the EIP-712 typed data for Vault.submitIntent. Records the Intent details the Executor checks against the on-chain detailsHash. 503 vault_unavailable if the chain is not configured',
  tags: ['vault'],
  request: { body: IntentPreviewRequest },
  response: IntentPreview,
});

export const IntentView = z.object({
  id: z.string().uuid(),
  status: IntentStatus,
  /** USDC. */
  amount: DecimalString,
  expiresAt: z.iso.datetime(),
  details: z.object({
    eventId: z.string(),
    marketId: z.string(),
    outcomeId: z.string(),
    venueId: z.string(),
    maxPrice: DecimalString,
    remainder: z.enum(['rest', 'return']),
  }),
  filledShares: DecimalString.nullable(),
  /** USDC spent on the fill. */
  spent: DecimalString.nullable(),
  reason: z.string().nullable(),
  /** Status changes, oldest first; starts with `previewed`. */
  timeline: z.array(
    z.object({ status: IntentStatus, at: z.iso.datetime(), reason: z.string().nullable() }),
  ),
});
export type IntentView = z.infer<typeof IntentView>;

export const getIntent = defineRoute({
  method: 'get',
  path: '/v1/vault/intents/{id}',
  operationId: 'getIntent',
  summary:
    'Intent status timeline (signed, dispatched, bridging, bridged, ordering, then filled / partially_filled / failed / expired / cancelled)',
  tags: ['vault'],
  request: { params: z.object({ id: z.string().uuid() }) },
  response: IntentView,
});

// ---------------------------------------------------------------- Deposit Wallet registration (#57)

export const DepositWalletState = z.object({
  /** none -> requested -> deployed -> registered. The Executor moves it along. */
  status: z.enum(['none', 'requested', 'deployed', 'registered']),
  owner: Address.nullable(),
  /** Polygon Deposit Wallet, once deployed. */
  wallet: Address.nullable(),
  /** Sign with `owner` (viem signTypedData) and PUT the signature; present while status is `deployed`. */
  registerTypedData: z
    .object({
      domain: TypedDomain,
      types: TypedTypes,
      primaryType: z.literal('RegisterDepositWallet'),
      message: z.object({ user: Address, wallet: Address }),
    })
    .nullable(),
  signatureReceived: z.boolean(),
});
export type DepositWalletState = z.infer<typeof DepositWalletState>;

export const getDepositWallet = defineRoute({
  method: 'get',
  path: '/v1/vault/deposit-wallet',
  operationId: 'getDepositWallet',
  summary:
    "The User's Polymarket Deposit Wallet and, once deployed, the registration typed data to sign. 503 vault_unavailable if the chain is not configured",
  tags: ['vault'],
  request: {},
  response: DepositWalletState,
});

export const requestDepositWallet = defineRoute({
  method: 'put',
  path: '/v1/vault/deposit-wallet',
  operationId: 'requestDepositWallet',
  summary:
    "Ask for a Deposit Wallet owned by a linked wallet and/or supply its EIP-712 RegisterDepositWallet signature. The Executor provisions it, verifies it is really that owner's wallet, then registers it with the Vault",
  tags: ['vault'],
  request: {
    body: z.object({
      owner: Address,
      signature: z
        .string()
        .regex(/^0x[0-9a-fA-F]+$/)
        .optional(),
    }),
  },
  response: DepositWalletState,
});
