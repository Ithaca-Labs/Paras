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
