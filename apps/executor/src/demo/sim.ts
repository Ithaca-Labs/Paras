import { toBase6 } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import { and, eq } from 'drizzle-orm';
import {
  decodeFunctionData,
  getAddress,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import type { Clob, Iris, PolygonChain } from '../intents/ports.js';
import { rampAbi, swapRouterAbi, tokenMessengerAbi } from '../wallet/abi.js';
import { CCTP_DOMAIN, POLYGON } from '../wallet/constants.js';
import type { RelayerClient } from '../wallet/relayer.js';
import type { WalletChain } from '../wallet/service.js';

/**
 * TESTNET DEMO (#98, `EXECUTOR_DEMO_MODE=simulate`): the Polymarket leg is simulated. The Vault on Monad testnet
 * is real; everything past its CCTP burn (mint, swap, wrap, CLOB, sweep back) is this in-memory world behind the
 * same ports the live code uses. Fills come from the LIVE Polymarket book at its quote price; no order is placed
 * and no Polygon tx is sent. State is in memory; CTF shares are re-seeded from open Positions after a restart (#126).
 */

const b32 = (a: Address) => pad(a, { size: 32 });
const word = (n: bigint | number) => pad(toHex(n), { size: 32 }).slice(2);
const MIN_FINALITY = '000007d0'.repeat(2); // 2000 twice (threshold + executed)

/** CCTP v2 MessageV2 + BurnMessageV2 as the Vault parses it (see `CctpMsg.encode` in the Foundry tests). */
export function cctpMessage(m: {
  sourceDomain: number;
  destDomain: number;
  nonce: Hex;
  sender: Address;
  destinationCaller: Hex;
  mintRecipient: Hex;
  burner: Address;
  amount: bigint;
}): Hex {
  const sender = b32(m.sender).slice(2);
  return ('0x' +
    `00000001${m.sourceDomain.toString(16).padStart(8, '0')}${m.destDomain.toString(16).padStart(8, '0')}` +
    `${m.nonce.slice(2)}${sender}${sender}${m.destinationCaller.slice(2)}${MIN_FINALITY}` +
    `00000001${'0'.repeat(64)}${m.mintRecipient.slice(2)}${word(m.amount)}${b32(m.burner).slice(2)}` +
    `${word(0)}${word(0)}${word(0)}`) as Hex;
}

interface Level {
  price: string;
  size: string;
}

export interface DemoSimOptions {
  /** Signs every attestation; must be the `attester` of the deployed DemoCctp (the Executor key). */
  attester: LocalAccount;
  /** DemoCctp on Monad (sender/recipient of every simulated CCTP message). */
  cctp: Address;
  vault: Address;
  db: Database;
  /** The DemoCctp burn behind a Vault dispatch tx, or null while unknown. */
  burnOf: (tx: Hex) => Promise<{ amount: bigint; mintRecipient: Hex } | null>;
  clobUrl: string;
  fetch?: typeof fetch;
}

/** In-memory Polygon + Polymarket behind the Executor ports. */
export function createDemoSim(o: DemoSimOptions) {
  const f = o.fetch ?? fetch;
  const bal = new Map<Address, { native: bigint; usdce: bigint; pusd: bigint }>();
  const ctf = new Map<string, bigint>();
  const usedNonces = new Set<Hex>();
  const burns = new Map<Hex, { wallet: Address; amount: bigint }>();
  const orders = new Map<string, { filledShares: string; spentUsd: string }>();
  const nonces = new Map<Address, bigint>();
  let txs = 0;

  const wallet = (w: Address) => {
    const k = getAddress(w);
    if (!bal.has(k)) bal.set(k, { native: 0n, usdce: 0n, pusd: 0n });
    return bal.get(k)!;
  };
  const ctfKey = (w: Address, t: string) => `${getAddress(w)}|${t}`;
  /** Wallet's shares of a token; after a restart, seeded once from the owner's open Positions. */
  const held = async (w: Address, t: string): Promise<bigint> => {
    const k = ctfKey(w, t);
    if (!ctf.has(k)) {
      const rows = await o.db
        .select({ shares: schema.positions.shares })
        .from(schema.positions)
        .innerJoin(
          schema.depositWallets,
          eq(schema.depositWallets.ownerAddress, schema.positions.userAddress),
        )
        .where(
          and(
            eq(schema.depositWallets.walletAddress, w.toLowerCase()),
            eq(schema.positions.tokenId, t),
            eq(schema.positions.status, 'open'),
          ),
        );
      if (!ctf.has(k))
        ctf.set(
          k,
          rows.reduce((n, r) => n + BigInt(r.shares), 0n),
        );
    }
    return ctf.get(k)!;
  };
  const nonceOf = (m: Hex) => m.slice(2 + 12 * 2, 2 + 44 * 2);
  const txHash = () => pad(toHex(++txs), { size: 32 });
  const attest = async (message: Hex) => ({
    message,
    attestation: await o.attester.sign!({ hash: keccak256(message) }),
  });

  const book = async (tokenId: string, side: 'asks' | 'bids'): Promise<Level[]> => {
    const res = await f(`${o.clobUrl}/book?token_id=${tokenId}`);
    if (!res.ok) throw new Error(`demo book ${res.status}`);
    const levels = ((await res.json()) as Record<string, Level[]>)[side] ?? [];
    return levels.sort((a, b) =>
      side === 'asks' ? Number(a.price) - Number(b.price) : Number(b.price) - Number(a.price),
    );
  };

  /** Walks the live book up to `limit` price; BUY spends `usd`, SELL sells `shares`. Shares floor to cents. */
  async function fill(req: Parameters<Clob['placeOrder']>[0]) {
    const sell = req.side === 'SELL';
    let leftUsd = Number(req.amountUsd);
    let leftShares = Number(req.shares ?? 0);
    let shares = 0;
    let usd = 0;
    for (const l of await book(req.tokenId, sell ? 'bids' : 'asks')) {
      const p = Number(l.price);
      if (sell ? p < Number(req.price) : p > Number(req.price)) break;
      const take = Math.min(Number(l.size), sell ? leftShares : leftUsd / p);
      if (!(take > 0)) break;
      shares += take;
      usd += take * p;
      leftShares -= take;
      leftUsd -= take * p;
      if (sell ? leftShares <= 0 : leftUsd <= 0.000001) break;
    }
    shares = sell
      ? Math.min(Math.floor(shares * 100) / 100, Number(req.shares))
      : Math.floor(shares * 100) / 100;
    return { shares, usd: sell ? usd : Math.min(usd, Number(req.amountUsd)) };
  }

  const clob: Clob = {
    async placeOrder(req) {
      if (orders.has(req.key)) return { orderId: req.key }; // idempotent per key
      const r = await fill(req);
      const w = wallet(req.wallet);
      const shares = toBase6(r.shares.toFixed(6));
      const usd = toBase6(r.usd.toFixed(6));
      const k = ctfKey(req.wallet, req.tokenId);
      const have = await held(req.wallet, req.tokenId);
      if (req.side === 'SELL') {
        ctf.set(k, have - shares);
        w.pusd += usd;
      } else {
        w.pusd -= usd;
        ctf.set(k, have + shares);
      }
      orders.set(req.key, { filledShares: r.shares.toFixed(6), spentUsd: r.usd.toFixed(6) });
      return { orderId: req.key };
    },
    // Resting (GTC) orders are not simulated: whatever crossed at placement is the fill, the rest is returned.
    getOrder: async (id) => ({ open: false, ...orders.get(id)! }),
    cancel: async () => {},
  };

  const polygon: PolygonChain & WalletChain = {
    balances: async (w) => ({ ...wallet(w) }),
    ctfBalance: held,
    // shortcut: no resolution/redemption in the demo (exit by selling), revisit if the demo needs auto-redeem
    payout: async () => ({ denominator: 0n, numerators: [] }),
    messageUsed: async (m) => usedNonces.has(nonceOf(m) as Hex),
    async receiveMessage(m) {
      usedNonces.add(nonceOf(m) as Hex);
      const body = m.slice(2 + 148 * 2);
      wallet(getAddress(`0x${body.slice(8 + 64 + 24, 8 + 64 + 64)}`)).native += BigInt(
        `0x${body.slice(8 + 128, 8 + 192)}`,
      );
    },
    predictWalletAddress: async (salt) => getAddress(`0x${salt.slice(2, 42)}`),
    async walletOwner(w) {
      const [row] = await o.db
        .select({ owner: schema.depositWallets.ownerAddress })
        .from(schema.depositWallets)
        .where(eq(schema.depositWallets.walletAddress, w.toLowerCase()));
      return row ? getAddress(row.owner) : null;
    },
  };

  const iris: Iris = {
    async attestation(domain, tx) {
      if (domain === CCTP_DOMAIN.monad) {
        const burn = await o.burnOf(tx);
        if (!burn) return null;
        return attest(
          cctpMessage({
            sourceDomain: CCTP_DOMAIN.monad,
            destDomain: CCTP_DOMAIN.polygon,
            nonce: keccak256(tx),
            sender: o.cctp,
            destinationCaller: pad('0x00', { size: 32 }),
            mintRecipient: burn.mintRecipient,
            burner: o.vault,
            amount: burn.amount,
          }),
        );
      }
      const burn = burns.get(tx);
      if (!burn) return null;
      return attest(
        cctpMessage({
          sourceDomain: CCTP_DOMAIN.polygon,
          destDomain: CCTP_DOMAIN.monad,
          nonce: keccak256(tx),
          sender: o.cctp,
          destinationCaller: b32(o.vault),
          mintRecipient: b32(o.vault),
          burner: burn.wallet,
          amount: burn.amount,
        }),
      );
    },
  };

  /** Applies the economic effect of each accepted batch (swap at its floor, wrap/unwrap, CCTP burn). */
  const relayer: RelayerClient = {
    deployWallet: async () => ({ txId: 'demo-deploy' }),
    getNonce: async (w) => nonces.get(w) ?? 0n,
    waitConfirmed: async (txId) => ({ txHash: txId.startsWith('0x') ? (txId as Hex) : undefined }),
    async submitBatch({ batch }) {
      const w = wallet(batch.wallet);
      nonces.set(batch.wallet, (nonces.get(batch.wallet) ?? 0n) + 1n);
      const hash = txHash();
      for (const c of batch.calls) {
        if (c.target === POLYGON.swapRouter02) {
          const p = decodeFunctionData({ abi: swapRouterAbi, data: c.data }).args[0];
          if (p.tokenIn === POLYGON.usdcNative)
            [w.native, w.usdce] = [w.native - p.amountIn, w.usdce + p.amountOutMinimum];
          else [w.usdce, w.native] = [w.usdce - p.amountIn, w.native + p.amountOutMinimum];
        } else if (c.target === POLYGON.onramp || c.target === POLYGON.offramp) {
          const { functionName, args } = decodeFunctionData({ abi: rampAbi, data: c.data });
          const n = args[2] as bigint;
          if (functionName === 'wrap') [w.usdce, w.pusd] = [w.usdce - n, w.pusd + n];
          else [w.pusd, w.usdce] = [w.pusd - n, w.usdce + n];
        } else if (c.target === POLYGON.tokenMessengerV2) {
          const amount = decodeFunctionData({ abi: tokenMessengerAbi, data: c.data })
            .args[0] as bigint;
          w.native -= amount;
          burns.set(hash, { wallet: getAddress(batch.wallet), amount });
        }
      }
      return { txId: hash };
    },
  };

  return { polygon, iris, relayer, clob };
}
