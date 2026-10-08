import { sanitizeReturnTo } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import { and, eq, gt } from 'drizzle-orm';
import { recoverMessageAddress } from 'viem';
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { HttpError } from '../errors.js';
import type { AuthDeps } from './types.js';

export async function issueNonce(db: Database, deps: AuthDeps, returnTo?: string) {
  const nonce = generateSiweNonce();
  const expiresAt = new Date(deps.now().getTime() + deps.config.nonceTtlMs);
  await db
    .insert(schema.siweNonces)
    .values({ nonce, returnTo: sanitizeReturnTo(returnTo), expiresAt });
  return { nonce, expiresAt };
}

/**
 * Verify an EIP-4361 message signed by an EOA (EIP-191 personal_sign). Consumes the nonce.
 * Returns the lowercase address, chain id and the `returnTo` stored with the nonce.
 * Contract wallets (EIP-1271) are not supported yet.
 */
export async function verifySiweMessage(
  db: Database,
  deps: AuthDeps,
  input: { message: string; signature: string },
): Promise<{ address: string; chainId: number; returnTo: string | null }> {
  const bad = (msg: string) => new HttpError(401, 'invalid_siwe', msg);
  const parsed = parseSiweMessage(input.message);
  if (!parsed.address || !parsed.nonce || !parsed.chainId) throw bad('Malformed SIWE message');
  if (!deps.config.chainIds.includes(parsed.chainId)) throw bad('Unsupported chain');
  const valid = validateSiweMessage({
    message: parsed as Parameters<typeof validateSiweMessage>[0]['message'],
    domain: deps.config.domain,
    time: deps.now(),
  });
  if (!valid) throw bad('SIWE message failed validation (domain, time or address)');

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    throw bad('Bad signature');
  }
  if (recovered.toLowerCase() !== parsed.address.toLowerCase()) throw bad('Signature mismatch');

  // Single-use: delete-returning is atomic, so a replay finds nothing.
  const [row] = await db
    .delete(schema.siweNonces)
    .where(
      and(eq(schema.siweNonces.nonce, parsed.nonce), gt(schema.siweNonces.expiresAt, deps.now())),
    )
    .returning();
  if (!row) throw bad('Unknown, used or expired nonce');

  return { address: parsed.address.toLowerCase(), chainId: parsed.chainId, returnTo: row.returnTo };
}
