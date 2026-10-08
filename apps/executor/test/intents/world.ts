import { createDb, schema, type DbHandle } from '@paras/db';
import { intentDetailsHash, registerTypedData, type IntentDetails } from '@paras/domain';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { decodeFunctionData, getAddress, pad, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { rampAbi, swapRouterAbi, tokenMessengerAbi } from '../../src/wallet/abi.js';
import { batchTypedData, type Batch } from '../../src/wallet/batch.js';
import { POLYGON, POLYGON_CHAIN_ID } from '../../src/wallet/constants.js';
import { IntentEngine } from '../../src/intents/engine.js';
import type { Clob, ClobOrderRequest, VaultEvent } from '../../src/intents/ports.js';
import { VAULT_STATUS } from '../../src/vault/abi.js';
import { EnvKeyCipher } from '../../src/wallet/key-cipher.js';
import type { RelayerClient } from '../../src/wallet/relayer.js';
import { WalletService } from '../../src/wallet/service.js';

export const VAULT = '0x2222222222222222222222222222222222222222' as Address;
export const USDC = (n: number) => BigInt(Math.round(n * 1e6));

/** CCTP v2 message: 148-byte header (nonce at 12..44) + body (amount at body+68, fee at body+164). */
export function cctpMessage(nonce: number, amount: bigint): Hex {
  const bytes = new Uint8Array(148 + 228);
  bytes.set(Buffer.from(pad(toHex(nonce), { size: 32 }).slice(2), 'hex'), 12);
  bytes.set(Buffer.from(pad(toHex(amount), { size: 32 }).slice(2), 'hex'), 148 + 68);
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

export type ClobMode = 'full' | 'partial' | 'none' | 'rest';

/**
 * One in-memory world behind every Executor port: Vault, Polygon balances, relayer, Iris and CLOB. The relayer
 * applies the effects of the (policy-checked, really signed) batches it receives, so balances follow the money.
 * `crashAfter(point)` makes the next effect at that point throw AFTER it happened, to prove restarts are safe.
 */
export class World {
  vault = new Map<string, { status: number; amount: bigint }>();
  burns = new Map<string, bigint>();
  usedPolygon = new Set<string>();
  usedMonad = new Set<string>();
  native = 0n;
  usdce = 0n;
  pusd = 0n;
  count = { dispatch: 0, mint: 0, batches: 0, orders: 0, cancels: 0, settles: 0, closes: 0, expires: 0 };
  geoblocked = false;
  clobMode: ClobMode = 'full';
  asks = [{ price: '0.50', size: '10000' }];
  crashPoint: string | null = null;
  submitted: Batch[] = [];
  private nonce = 0;
  private orders = new Map<string, { req: ClobOrderRequest; cancelled: boolean }>();
  private txs = 0;

  crash(point: string) {
    if (this.crashPoint === point) {
      this.crashPoint = null;
      throw new Error(`injected crash at ${point}`);
    }
  }
  key = (user: Address, id: Hex) => `${user.toLowerCase()}|${id}`;

  vaultChain = {
    address: VAULT,
    events: async () => ({ events: [] as VaultEvent[], toBlock: 0n }),
    intentStatus: async (u: Address, id: Hex) => this.vault.get(this.key(u, id))?.status ?? 0,
    dispatch: async (u: Address, id: Hex) => {
      const v = this.vault.get(this.key(u, id))!;
      if (v.status !== VAULT_STATUS.Reserved) throw new Error('WrongStatus');
      v.status = VAULT_STATUS.Dispatched;
      this.count.dispatch++;
      const hash = pad(toHex(++this.txs), { size: 32 });
      this.burns.set(hash, v.amount);
      this.crash('after-dispatch');
      return hash;
    },
    dispatchTx: async (u: Address, id: Hex) => {
      const v = this.vault.get(this.key(u, id))!;
      return [...this.burns].find(([, a]) => a === v.amount)?.[0] as Hex;
    },
    expireIntent: async (u: Address, id: Hex) => {
      this.vault.get(this.key(u, id))!.status = VAULT_STATUS.Expired;
      this.count.expires++;
    },
    closeIntent: async (u: Address, id: Hex) => {
      this.vault.get(this.key(u, id))!.status = VAULT_STATUS.Closed;
      this.count.closes++;
    },
    settle: async (m: Hex) => {
      if (this.usedMonad.has(m)) throw new Error('nonce used');
      this.usedMonad.add(m);
      this.count.settles++;
      this.crash('after-settle');
    },
    messageUsed: async (m: Hex) => this.usedMonad.has(m),
  };

  polygonChain = {
    balances: async () => ({ native: this.native, usdce: this.usdce, pusd: this.pusd }),
    messageUsed: async (m: Hex) => this.usedPolygon.has(m),
    receiveMessage: async (m: Hex) => {
      if (this.usedPolygon.has(m)) throw new Error('nonce used');
      this.usedPolygon.add(m);
      this.native += BigInt(`0x${m.slice(2 + (148 + 68) * 2, 2 + (148 + 100) * 2)}`);
      this.count.mint++;
      this.crash('after-mint');
    },
  };

  iris = {
    attestation: async (_domain: number, tx: Hex) => {
      const amount = this.burns.get(tx);
      if (amount === undefined) return null;
      return { message: cctpMessage(Number(BigInt(tx)), amount), attestation: '0xabcd' as Hex };
    },
  };

  books = { asks: async () => ({ asks: this.asks, fee: { kind: 'none' as const } }) };
  geoblock = { allowed: async () => !this.geoblocked };

  clob: Clob = {
    placeOrder: async (req) => {
      const existing = this.orders.get(req.key);
      if (existing) return { orderId: req.key }; // idempotent per key
      this.orders.set(req.key, { req, cancelled: false });
      this.count.orders++;
      this.crash('after-order');
      return { orderId: req.key };
    },
    getOrder: async (id) => {
      const { req, cancelled } = this.orders.get(id)!;
      const amt = Number(req.amountUsd);
      const price = Number(req.price);
      const spent = this.clobMode === 'full' ? amt : this.clobMode === 'none' ? 0 : amt / 2;
      const open = this.clobMode === 'rest' && !cancelled;
      return { open, filledShares: String(spent / price), spentUsd: String(spent) };
    },
    cancel: async (id) => {
      this.orders.get(id)!.cancelled = true;
      this.count.cancels++;
    },
  };

  /** Relayer double that applies the economic effect of each batch it accepts. */
  relayer: RelayerClient = {
    deployWallet: async () => ({ txId: 'deploy' }),
    getNonce: async () => BigInt(this.nonce),
    waitConfirmed: async (txId) => ({ txHash: pad(toHex(Number(txId.split('-')[1] ?? 0) + 1000), { size: 32 }) }),
    submitBatch: async ({ batch }) => {
      this.nonce++;
      this.count.batches++;
      this.submitted.push(batch);
      for (const c of batch.calls) this.apply(c.target, c.data);
      const id = this.nonce;
      this.burnsByBatch(batch, id);
      this.crash('after-batch');
      return { txId: `tx-${id}` };
    },
  };

  private burnsByBatch(batch: Batch, id: number) {
    const burn = batch.calls.find((c) => c.target === POLYGON.tokenMessengerV2);
    if (!burn) return;
    const { args } = decodeFunctionData({ abi: tokenMessengerAbi, data: burn.data });
    this.burns.set(pad(toHex(id + 1000), { size: 32 }), args[0] as bigint);
  }

  private apply(target: Address, data: Hex) {
    if (target === POLYGON.swapRouter02) {
      const p = decodeFunctionData({ abi: swapRouterAbi, data }).args[0];
      if (p.tokenIn === POLYGON.usdcNative) {
        this.native -= p.amountIn;
        this.usdce += p.amountOutMinimum;
      } else {
        this.usdce -= p.amountIn;
        this.native += p.amountOutMinimum;
      }
    } else if (target === POLYGON.onramp || target === POLYGON.offramp) {
      const { functionName, args } = decodeFunctionData({ abi: rampAbi, data });
      const amount = args[2] as bigint;
      if (functionName === 'wrap') [this.usdce, this.pusd] = [this.usdce - amount, this.pusd + amount];
      else [this.pusd, this.usdce] = [this.pusd - amount, this.usdce + amount];
    } else if (target === POLYGON.tokenMessengerV2) {
      this.native -= decodeFunctionData({ abi: tokenMessengerAbi, data }).args[0] as bigint;
    }
  }
}

export interface Harness {
  world: World;
  db: DbHandle['db'];
  svc: WalletService;
  userId: string;
  userAddress: Address;
  clock: { now: Date };
  engine: () => IntentEngine;
  /** Inserts a previewed Intent, reserves it on the fake Vault and applies the `submitted` event. */
  newIntent: (o?: { amount?: number; maxPrice?: string; remainder?: 'rest' | 'return'; expiresInMs?: number }) => Promise<string>;
  close: () => Promise<void>;
}

/** Real DB, real WalletService (policy layer, session key, owner-signed grant) over the fake world. */
export async function createHarness(): Promise<Harness> {
  const testDb: TestDatabase = await createTestDatabase();
  const h = createDb(testDb.url);
  const world = new World();
  const owner = privateKeyToAccount(generatePrivateKey());
  const clock = { now: new Date('2026-10-09T12:00:00Z') };
  const [u] = await h.db.insert(schema.users).values({}).returning();
  const svc = new WalletService({
    db: h.db,
    cipher: new EnvKeyCipher('11'.repeat(32)),
    relayer: world.relayer,
    now: () => clock.now,
    chain: {
      predictWalletAddress: async (salt) => getAddress(`0x${salt.slice(2, 42)}`),
      walletOwner: async () => owner.address,
    },
    vault: { vault: VAULT, chainId: 143, registerDepositWallet: async () => {} },
  });
  const w = await svc.provision({ userId: u!.id, owner: owner.address });
  await svc.registerWithVault(
    w.id,
    await owner.signTypedData(
      registerTypedData({ vault: VAULT, chainId: 143, user: owner.address, wallet: getAddress(w.walletAddress) }),
    ),
  );
  const p = await svc.beginSessionKeyChange(w.id);
  await svc.completeSessionKeyChange({
    keyId: p.keyId,
    batch: p.batch,
    ownerSignature: await owner.signTypedData(batchTypedData(p.batch, POLYGON_CHAIN_ID)),
  });
  world.submitted.length = 0;
  world.count.batches = 0;

  const engine = () =>
    new IntentEngine({
      db: h.db,
      wallets: svc,
      relayer: world.relayer,
      vault: world.vaultChain,
      polygon: world.polygonChain,
      iris: world.iris,
      clob: world.clob,
      books: world.books,
      geoblock: world.geoblock,
      now: () => clock.now,
    });

  let n = 0;
  return {
    world,
    db: h.db,
    svc,
    userId: u!.id,
    userAddress: owner.address,
    clock,
    engine,
    async newIntent(o = {}) {
      const amount = USDC(o.amount ?? 10);
      const id = pad(toHex(++n), { size: 32 });
      const expiry = new Date(clock.now.getTime() + (o.expiresInMs ?? 3_600_000));
      const details: IntentDetails = {
        eventId: 'e',
        marketId: 'm',
        outcomeId: 'o',
        venueId: 'polymarket',
        tokenId: '123',
        maxPrice: o.maxPrice ?? '0.55',
        remainder: o.remainder ?? 'return',
      };
      const [row] = await h.db
        .insert(schema.intents)
        .values({
          userId: u!.id,
          userAddress: owner.address.toLowerCase(),
          intentId: id,
          amountUsdc: amount.toString(),
          expiry,
          details,
          detailsHash: intentDetailsHash(details),
        })
        .returning();
      world.vault.set(world.key(owner.address, id), { status: VAULT_STATUS.Reserved, amount });
      await engine().onVaultEvent({
        kind: 'submitted',
        user: owner.address,
        id,
        amount,
        expiry: BigInt(Math.floor(expiry.getTime() / 1000)),
        detailsHash: intentDetailsHash(details),
        block: 1n,
      });
      return row!.id;
    },
    async close() {
      await h.close();
      await testDb.drop();
    },
  };
}
