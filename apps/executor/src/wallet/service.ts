import { schema, type Database } from '@paras/db';
import { registerTypedData } from '@paras/domain';
import { and, eq } from 'drizzle-orm';
import {
  encodePacked,
  getAddress,
  isAddressEqual,
  keccak256,
  verifyTypedData,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { batchTypedData, signBatchAsSession, type Batch, type Call } from './batch.js';
import { authorizeSessionSigner, revokeSessionSigner } from './calls.js';
import { POLYGON_CHAIN_ID, SESSION_KEY_TTL_SECONDS } from './constants.js';
import type { KeyCipher } from './key-cipher.js';
import { checkBatch, checkClobAction, type ClobAction } from './policy.js';
import type { RelayerClient } from './relayer.js';

const { depositWallets, executorSessionKeys, intentFunding } = schema;

export type DepositWalletRow = typeof depositWallets.$inferSelect;
export type SessionKeyRow = typeof executorSessionKeys.$inferSelect;

/** Reads Polygon: the factory's counterfactual wallet address and a deployed wallet's owner (`eth_call`s). */
export interface WalletChain {
  predictWalletAddress(salt: Hex): Promise<Address>;
  /** On-chain `owner()` of the wallet, or null while it is not deployed. */
  walletOwner(wallet: Address): Promise<Address | null>;
}

/** Registers a Deposit Wallet with the Monad Vault, bound to the user's EIP-712 signature. */
export interface VaultRegistry {
  /** Address of the Vault on Monad; the only external destination the Executor may bridge to. */
  readonly vault: Address;
  /** Monad chain id (EIP-712 domain of the registration signature). */
  readonly chainId: number;
  registerDepositWallet(p: {
    userId: string;
    owner: Address;
    wallet: Address;
    signature: Hex;
  }): Promise<void>;
}

/** Factory id of a user's Deposit Wallet; the same value every time, so provisioning is idempotent. */
export const walletSalt = (userId: string): Hex =>
  keccak256(encodePacked(['string', 'string'], ['paras:deposit-wallet:', userId]));

export interface WalletServiceDeps {
  db: Database;
  cipher: KeyCipher;
  relayer: RelayerClient;
  chain: WalletChain;
  vault: VaultRegistry;
  now?: () => Date;
  chainId?: number;
  /** Days before expiry when a key becomes due for rotation. Default 30. */
  rotationWindowDays?: number;
}

export interface PendingKeyChange {
  keyId: string;
  sessionAddress: Address;
  validUntil: Date;
  /** Owner-signed batch: revoke the current key (if any) and authorize the new one. */
  batch: Batch;
  typedData: ReturnType<typeof batchTypedData>;
}

const lc = (a: string) => a.toLowerCase();
const BATCH_TTL_S = 3600n;

export class WalletService {
  private readonly now: () => Date;
  private readonly chainId: number;

  constructor(private readonly d: WalletServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.chainId = d.chainId ?? POLYGON_CHAIN_ID;
  }

  /** Idempotently deploys the user's Deposit Wallet (owner = the user's own EOA) via the relayer. */
  async provision(p: { userId: string; owner: Address }): Promise<DepositWalletRow> {
    const { db } = this.d;
    const chainId = String(this.chainId);
    let row = (
      await db
        .select()
        .from(depositWallets)
        .where(and(eq(depositWallets.userId, p.userId), eq(depositWallets.chainId, chainId)))
    )[0];
    if (!row) {
      const salt = walletSalt(p.userId);
      const wallet = await this.d.chain.predictWalletAddress(salt);
      [row] = await db
        .insert(depositWallets)
        .values({
          userId: p.userId,
          ownerAddress: lc(p.owner),
          walletAddress: lc(wallet),
          salt,
          chainId,
        })
        .onConflictDoNothing()
        .returning();
      row ??= (
        await db
          .select()
          .from(depositWallets)
          .where(eq(depositWallets.walletAddress, lc(wallet)))
      )[0];
    }
    if (!row) throw new Error('wallet row missing');
    if (!isAddressEqual(row.ownerAddress as Address, p.owner))
      throw new Error('owner differs from the provisioned wallet owner');
    if (row.status !== 'pending') return row;

    const { txId } = await this.d.relayer.deployWallet({ owner: p.owner, salt: row.salt as Hex });
    await db.update(depositWallets).set({ deployTxId: txId }).where(eq(depositWallets.id, row.id));
    await this.d.relayer.waitConfirmed(txId);
    const [done] = await db
      .update(depositWallets)
      .set({ status: 'deployed' })
      .where(eq(depositWallets.id, row.id))
      .returning();
    return done!;
  }

  /**
   * Registers the wallet with the Vault using the user's signature. SECURITY: the Vault credits returns to whoever
   * is mapped to the wallet, so before relaying we prove the wallet is the user's OWN Deposit Wallet: it derives from
   * this user's factory id (counterfactual address) and, on-chain, its owner is the signing EOA. Otherwise an
   * attacker could register a victim's wallet under their own address and receive the victim's returns.
   */
  async registerWithVault(walletId: string, signature: Hex): Promise<DepositWalletRow> {
    const w = await this.wallet(walletId);
    if (w.status === 'pending') throw new Error('wallet not deployed');
    if (w.status === 'registered') return w;
    const owner = getAddress(w.ownerAddress);
    const wallet = getAddress(w.walletAddress);
    const salt = walletSalt(w.userId);
    if (w.salt !== salt || !isAddressEqual(await this.d.chain.predictWalletAddress(salt), wallet))
      throw new Error('wallet is not derived from this user');
    const onChainOwner = await this.d.chain.walletOwner(wallet);
    if (!onChainOwner || !isAddressEqual(onChainOwner, owner))
      throw new Error('wallet owner is not the registering user');
    const ok = await verifyTypedData({
      address: owner,
      signature,
      ...registerTypedData({
        vault: this.d.vault.vault,
        chainId: this.d.vault.chainId,
        user: owner,
        wallet,
      }),
    });
    if (!ok) throw new Error('registration signature invalid');
    await this.d.vault.registerDepositWallet({ userId: w.userId, owner, wallet, signature });
    const [done] = await this.d.db
      .update(depositWallets)
      .set({ status: 'registered', registeredAt: this.now() })
      .where(eq(depositWallets.id, walletId))
      .returning();
    return done!;
  }

  /**
   * Step 1 of grant/rotation: generate a fresh session key (stored encrypted, `pending`) and return the batch
   * the wallet OWNER must sign. Includes a revoke of the active key, so one signature rotates.
   */
  async beginSessionKeyChange(walletId: string): Promise<PendingKeyChange> {
    const w = await this.wallet(walletId);
    if (w.status === 'pending') throw new Error('wallet not deployed');
    const { db } = this.d;
    // Abandon earlier unsigned requests.
    await db
      .update(executorSessionKeys)
      .set({ status: 'revoked', revokedAt: this.now() })
      .where(
        and(eq(executorSessionKeys.walletId, walletId), eq(executorSessionKeys.status, 'pending')),
      );

    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const validUntil = new Date(this.now().getTime() + SESSION_KEY_TTL_SECONDS * 1000);
    const [key] = await db
      .insert(executorSessionKeys)
      .values({
        walletId,
        address: lc(address),
        ciphertext: await this.d.cipher.encrypt(pk, lc(address)),
        validUntil,
      })
      .returning();
    const active = await this.activeKey(walletId);
    const wallet = getAddress(w.walletAddress);
    const batch: Batch = {
      wallet,
      nonce: await this.d.relayer.getNonce(wallet),
      deadline: BigInt(Math.floor(this.now().getTime() / 1000)) + BATCH_TTL_S,
      calls: this.ownerCalls(
        wallet,
        address,
        validUntil,
        active ? getAddress(active.address) : undefined,
      ),
    };
    return {
      keyId: key!.id,
      sessionAddress: address,
      validUntil,
      batch,
      typedData: batchTypedData(batch, this.chainId),
    };
  }

  /** Step 2: verify the owner really signed the expected batch, submit via the relayer, flip key states. */
  async completeSessionKeyChange(p: {
    keyId: string;
    batch: Batch;
    ownerSignature: Hex;
  }): Promise<SessionKeyRow> {
    const { db } = this.d;
    const key = (
      await db.select().from(executorSessionKeys).where(eq(executorSessionKeys.id, p.keyId))
    )[0];
    if (!key || key.status !== 'pending') throw new Error('no pending session key');
    const w = await this.wallet(key.walletId);
    const wallet = getAddress(w.walletAddress);
    const owner = getAddress(w.ownerAddress);
    const old = await this.activeKey(w.id);

    const expected = this.ownerCalls(
      wallet,
      getAddress(key.address),
      key.validUntil,
      old ? getAddress(old.address) : undefined,
    );
    const same =
      isAddressEqual(p.batch.wallet, wallet) &&
      p.batch.calls.length === expected.length &&
      p.batch.calls.every(
        (c, i) =>
          isAddressEqual(c.target, expected[i]!.target) &&
          c.value === 0n &&
          c.data === expected[i]!.data,
      );
    if (!same) throw new Error('batch does not match the pending session key change');
    const ok = await verifyTypedData({
      address: owner,
      signature: p.ownerSignature,
      ...batchTypedData(p.batch, this.chainId),
    });
    if (!ok) throw new Error('owner signature invalid');

    const { txId } = await this.d.relayer.submitBatch({
      batch: p.batch,
      signature: p.ownerSignature,
      signer: owner,
    });
    await this.d.relayer.waitConfirmed(txId);

    const now = this.now();
    return db.transaction(async (tx) => {
      if (old)
        await tx
          .update(executorSessionKeys)
          .set({ status: 'revoked', revokedAt: now })
          .where(eq(executorSessionKeys.id, old.id));
      const [active] = await tx
        .update(executorSessionKeys)
        .set({ status: 'active', activatedAt: now })
        .where(eq(executorSessionKeys.id, key.id))
        .returning();
      return active!;
    });
  }

  /** Local kill switch: stop the Executor using a key at once. The on-chain revoke still needs the owner (rotation). */
  async disableSessionKey(keyId: string): Promise<void> {
    await this.d.db
      .update(executorSessionKeys)
      .set({ status: 'revoked', revokedAt: this.now() })
      .where(eq(executorSessionKeys.id, keyId));
  }

  /** Active keys expiring within the rotation window. */
  async keysDueForRotation(): Promise<SessionKeyRow[]> {
    const cutoff = this.now().getTime() + (this.d.rotationWindowDays ?? 30) * 86_400_000;
    const keys = await this.d.db
      .select()
      .from(executorSessionKeys)
      .where(eq(executorSessionKeys.status, 'active'));
    return keys.filter((k) => k.validUntil.getTime() <= cutoff);
  }

  /** The registered Deposit Wallet whose owner is `owner` (the Vault account address). */
  async registeredWalletOf(owner: Address): Promise<DepositWalletRow | undefined> {
    const [w] = await this.d.db
      .select()
      .from(depositWallets)
      .where(
        and(
          eq(depositWallets.ownerAddress, lc(owner)),
          eq(depositWallets.chainId, String(this.chainId)),
          eq(depositWallets.status, 'registered'),
        ),
      );
    return w;
  }

  /** CLOB scope check (maker/signer must be the wallet, key unexpired) before the order client signs anything. */
  async checkClob(walletId: string, action: ClobAction): Promise<void> {
    const key = await this.activeKey(walletId);
    if (!key) throw new Error('no active session key');
    checkClobAction(action, {
      wallet: getAddress((await this.wallet(walletId)).walletAddress),
      now: this.now(),
      keyValidUntil: key.validUntil,
    });
  }

  /** The active session key of a Deposit Wallet, for CLOB order/auth signing. Callers run `checkClob` first. */
  async sessionAccount(wallet: Address): Promise<LocalAccount> {
    const [w] = await this.d.db
      .select()
      .from(depositWallets)
      .where(eq(depositWallets.walletAddress, lc(wallet)));
    const key = w && (await this.activeKey(w.id));
    if (!key) throw new Error('no active session key');
    return privateKeyToAccount((await this.d.cipher.decrypt(key.ciphertext, key.address)) as Hex);
  }

  /** Cap on funding (USDC base units) an Intent may bring into its wallet on Polygon. */
  async openIntent(p: { intentId: string; walletId: string; capUsdc: bigint }): Promise<void> {
    await this.d.db
      .insert(intentFunding)
      .values({ intentId: p.intentId, walletId: p.walletId, capUsdc: p.capUsdc.toString() })
      .onConflictDoNothing();
  }

  /**
   * The only path that signs with a session key. Order: policy check (no key material touched) ->
   * reserve funding -> decrypt+sign -> relayer. A rejected batch never decrypts a key.
   */
  async submitSessionBatch(p: {
    walletId: string;
    intentId: string;
    calls: Call[];
  }): Promise<{ txId: string }> {
    const { db } = this.d;
    const w = await this.wallet(p.walletId);
    const key = await this.activeKey(p.walletId);
    if (!key) throw new Error('no active session key');
    const wallet = getAddress(w.walletAddress);
    const now = this.now();
    const batch: Batch = {
      wallet,
      nonce: await this.d.relayer.getNonce(wallet),
      deadline: BigInt(Math.floor(now.getTime() / 1000)) + BATCH_TTL_S,
      calls: p.calls,
    };

    const funding = await db.transaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(intentFunding)
        .where(and(eq(intentFunding.intentId, p.intentId), eq(intentFunding.walletId, p.walletId)))
        .for('update');
      if (!f) throw new Error('unknown Intent for this wallet');
      const remaining = BigInt(f.capUsdc) - BigInt(f.fundedUsdc);
      const res = checkBatch(batch, {
        wallet,
        vault: this.d.vault.vault,
        now,
        keyValidUntil: key.validUntil,
        fundingRemaining: remaining,
      });
      await tx
        .update(intentFunding)
        .set({ fundedUsdc: (BigInt(f.fundedUsdc) + res.funding).toString(), updatedAt: now })
        .where(eq(intentFunding.intentId, p.intentId));
      return res.funding;
    });

    try {
      const pk = (await this.d.cipher.decrypt(key.ciphertext, key.address)) as Hex;
      const signature = await signBatchAsSession(pk, batch, this.chainId);
      const { txId } = await this.d.relayer.submitBatch({
        batch,
        signature,
        signer: getAddress(key.address),
      });
      return { txId };
    } catch (e) {
      // Not submitted: release the reservation.
      const [f] = await db
        .select()
        .from(intentFunding)
        .where(eq(intentFunding.intentId, p.intentId));
      if (f && funding > 0n)
        await db
          .update(intentFunding)
          .set({ fundedUsdc: (BigInt(f.fundedUsdc) - funding).toString() })
          .where(eq(intentFunding.intentId, p.intentId));
      throw e;
    }
  }

  private ownerCalls(
    wallet: Address,
    session: Address,
    validUntil: Date,
    revoke?: Address,
  ): Call[] {
    return [
      ...(revoke ? [revokeSessionSigner(wallet, revoke)] : []),
      authorizeSessionSigner(wallet, session, BigInt(Math.floor(validUntil.getTime() / 1000))),
    ];
  }

  private async wallet(id: string): Promise<DepositWalletRow> {
    const [w] = await this.d.db.select().from(depositWallets).where(eq(depositWallets.id, id));
    if (!w) throw new Error('unknown wallet');
    return w;
  }

  private async activeKey(walletId: string): Promise<SessionKeyRow | undefined> {
    const [k] = await this.d.db
      .select()
      .from(executorSessionKeys)
      .where(
        and(eq(executorSessionKeys.walletId, walletId), eq(executorSessionKeys.status, 'active')),
      );
    return k;
  }
}
