import { checkDelegatedRequest, type DelegationScope } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import { and, eq, sql } from 'drizzle-orm';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import type { PrivyPort, TypedDataInput } from './port.js';

const vaultAbi = parseAbi([
  'function submitIntent((address user, bytes32 id, uint256 amount, uint64 expiry, bytes32 detailsHash) i, bytes sig)',
  'function cancelIntent(bytes32 id)',
]);

/** Thrown when a request is outside the User's delegation. `code` is machine-readable. */
export class DelegationError extends Error {
  constructor(readonly code: string) {
    super(`delegation refused: ${code}`);
  }
}

interface TypedPayload {
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

// Privy takes JSON: bigints become decimal strings, addresses lowercase (its string compare is case-sensitive).
const jsonSafe = (t: TypedPayload): TypedDataInput => ({
  ...t,
  domain: {
    ...t.domain,
    ...(t.domain.verifyingContract && {
      verifyingContract: t.domain.verifyingContract.toLowerCase(),
    }),
  },
  message: Object.fromEntries(
    Object.entries(t.message).map(([k, v]) => [
      k,
      typeof v === 'bigint'
        ? v.toString()
        : typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
          ? v.toLowerCase()
          : v,
    ]),
  ),
});

/**
 * Signs / sends for a User under their Privy delegation. Every call is checked against the
 * User's active delegation first (`checkDelegatedRequest`, same allowlist as the Privy policy),
 * and Intent amounts are charged to the cumulative cap atomically. Privy then enforces its own policy.
 */
export function createDelegatedSigner(d: {
  privy: PrivyPort;
  db: Database;
  vault: string;
  chainId: number;
}) {
  const { privy, db } = d;

  async function active(userId: string) {
    const [row] = await db
      .select({ del: schema.delegations, address: schema.privyWallets.address })
      .from(schema.delegations)
      .innerJoin(schema.privyWallets, eq(schema.privyWallets.walletId, schema.delegations.walletId))
      .where(and(eq(schema.delegations.userId, userId), eq(schema.delegations.status, 'active')));
    if (!row) throw new DelegationError('no_active_delegation');
    const scope: DelegationScope = {
      vault: d.vault,
      chainId: d.chainId,
      wallet: row.address,
      maxIntent: BigInt(row.del.maxIntentUsdc),
    };
    return { walletId: row.del.walletId, scope };
  }

  const charge = async (walletId: string, amount: bigint, sign: 1 | -1) => {
    const a = amount.toString();
    const rows = await db
      .update(schema.delegations)
      .set({
        spentUsdc: sql`(${schema.delegations.spentUsdc}::numeric + ${a}::numeric * ${sign})::text`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.delegations.walletId, walletId),
          sign === 1
            ? sql`${schema.delegations.status} = 'active' and ${schema.delegations.spentUsdc}::numeric + ${a}::numeric <= ${schema.delegations.capUsdc}::numeric`
            : undefined,
        ),
      )
      .returning({ w: schema.delegations.walletId });
    return rows.length > 0;
  };

  async function sign(userId: string, t: TypedPayload): Promise<Hex> {
    const { walletId, scope } = await active(userId);
    const bad = checkDelegatedRequest(scope, {
      kind: 'typedData',
      domain: t.domain,
      primaryType: t.primaryType,
      message: t.message,
    });
    if (bad) throw new DelegationError(bad);
    const spend = t.primaryType === 'Intent' ? (t.message.amount as bigint) : 0n;
    if (spend && !(await charge(walletId, spend, 1))) throw new DelegationError('over_spend_cap');
    try {
      return await privy.signTypedData(walletId, jsonSafe(t));
    } catch (err) {
      if (spend) await charge(walletId, spend, -1);
      throw err;
    }
  }

  async function send(userId: string, fn: 'submitIntent' | 'cancelIntent', data: Hex) {
    const { walletId, scope } = await active(userId);
    const bad = checkDelegatedRequest(scope, {
      kind: 'tx',
      to: d.vault,
      value: 0n,
      fn,
      chainId: d.chainId,
    });
    if (bad) throw new DelegationError(bad);
    return privy.sendTransaction(walletId, {
      chainId: d.chainId,
      to: d.vault.toLowerCase(),
      data,
    });
  }

  return {
    /** Signs the Intent typed data (`intentTypedData`) with the User's wallet. */
    signIntent: (userId: string, typed: TypedPayload) => sign(userId, typed),
    /** Signs the off-chain Exit typed data (`exitTypedData`). */
    signExit: (userId: string, typed: TypedPayload) => sign(userId, typed),
    /** Relays a signed Intent: `Vault.submitIntent`, sent from the User's wallet (it pays gas). */
    submitIntent: (
      userId: string,
      i: { user: Hex; id: Hex; amount: bigint; expiry: bigint; detailsHash: Hex },
      sig: Hex,
    ) =>
      send(
        userId,
        'submitIntent',
        encodeFunctionData({ abi: vaultAbi, functionName: 'submitIntent', args: [i, sig] }),
      ),
    cancelIntent: (userId: string, id: Hex) =>
      send(
        userId,
        'cancelIntent',
        encodeFunctionData({ abi: vaultAbi, functionName: 'cancelIntent', args: [id] }),
      ),
  };
}

export type DelegatedSigner = ReturnType<typeof createDelegatedSigner>;
