import type { BookLevel, FeeModel, IntentDetails } from '@paras/domain';
import type { Address, Hex } from 'viem';

export type VaultEvent =
  | {
      kind: 'submitted';
      user: Address;
      id: Hex;
      amount: bigint;
      expiry: bigint;
      detailsHash: Hex;
      block: bigint;
      tx?: Hex;
    }
  | { kind: 'cancelled' | 'expired'; user: Address; id: Hex; block: bigint }
  /** Vault cash movements: history only, the Intent engine ignores them. */
  | VaultCash<'deposited'>
  | VaultCash<'withdrawn'>;

interface VaultCash<K extends string> {
  kind: K;
  user: Address;
  amount: bigint;
  block: bigint;
  tx: Hex;
  logIndex: number;
  at: Date;
}

/** Monad side: the Vault (Executor key) and its CCTP MessageTransmitter. Real impl: `chains.ts`. */
export interface VaultChain {
  readonly address: Address;
  /** Vault Intent events in [fromBlock, toBlock]; `toBlock` is a confirmed head. */
  events(fromBlock: bigint): Promise<{ events: VaultEvent[]; toBlock: bigint }>;
  /** Vault `Status` of the Intent (see VAULT_STATUS). */
  intentStatus(user: Address, id: Hex): Promise<number>;
  /** CCTP burn to the user's registered Deposit Wallet. Resolves with the tx hash once mined. */
  dispatch(user: Address, id: Hex): Promise<Hex>;
  /** Hash of the tx that dispatched the Intent, if it was already dispatched (restart recovery). */
  dispatchTx(user: Address, id: Hex): Promise<Hex | null>;
  /** Releases an undispatched, expired Intent back to idle (anyone may call). */
  expireIntent(user: Address, id: Hex): Promise<void>;
  /** Writes off what is still in flight for an Intent (bookkeeping only). */
  closeIntent(user: Address, id: Hex): Promise<void>;
  /** Credits an attested return burn to the user. Resolves with the tx hash. `intentId` 0x0 reduces no claim. */
  settle(message: Hex, attestation: Hex, intentId: Hex): Promise<Hex>;
  /** Whether this CCTP message was already received on Monad. */
  messageUsed(message: Hex): Promise<boolean>;
}

export interface WalletBalances {
  /** Native USDC, USDC.e and pUSD, base units. */
  native: bigint;
  usdce: bigint;
  pusd: bigint;
}

/** Polygon side reads/writes the Executor does itself (everything touching the wallet goes via the relayer). */
export interface PolygonChain {
  balances(wallet: Address): Promise<WalletBalances>;
  /** CTF (ERC1155) shares of one position id held by the wallet, base units. */
  ctfBalance(wallet: Address, tokenId: string): Promise<bigint>;
  /** CTF resolution: `denominator` is 0 until the oracle reports; payout of outcome i = numerators[i]/denominator. */
  payout(conditionId: Hex): Promise<{ denominator: bigint; numerators: bigint[] }>;
  messageUsed(message: Hex): Promise<boolean>;
  /** Permissionless CCTP mint to the burn's recipient; the Executor pays gas. */
  receiveMessage(message: Hex, attestation: Hex): Promise<void>;
}

/** Circle Iris: attestation for a burn tx. Null while pending. */
export interface Iris {
  attestation(
    sourceDomain: number,
    txHash: Hex,
  ): Promise<{ message: Hex; attestation: Hex } | null>;
}

export interface ClobOrderRequest {
  /** Idempotency key: the same key must never produce a second live order. */
  key: string;
  wallet: Address;
  tokenId: string;
  /** BUY (default) spends `amountUsd`; SELL sells `shares` for at least `price` each. */
  side?: 'BUY' | 'SELL';
  /** SELL only: shares to sell, decimal. */
  shares?: string;
  /** Limit price per share, decimal (BUY: worst price paid; SELL: worst price accepted). */
  price: string;
  /** Collateral to spend, USD decimal (SELL: the expected notional, `shares * price`). */
  amountUsd: string;
  /** FAK fills what crosses now and cancels the rest; GTC rests the remainder. */
  type: 'FAK' | 'GTC';
}

/**
 * Polymarket CLOB as the session key sees it: POLY_1271 orders (maker = signer = Deposit Wallet) with the Paras
 * builder code attached. The real client is follow-up work that needs builder credentials (#35).
 */
export interface Clob {
  placeOrder(o: ClobOrderRequest): Promise<{ orderId: string }>;
  /** For SELL orders `spentUsd` is the USD received. */
  getOrder(orderId: string): Promise<{ open: boolean; filledShares: string; spentUsd: string }>;
  cancel(orderId: string): Promise<void>;
}

/** Live asks and fee model for the Intent's Outcome. */
export interface BookSource {
  asks(d: IntentDetails): Promise<{ asks: BookLevel[]; fee: FeeModel; negRisk?: boolean }>;
}

/** Polymarket geoblock for the Executor host. Errors count as blocked (fail closed). */
export interface Geoblock {
  allowed(): Promise<boolean>;
}

export interface WalletTransfer {
  wallet: Address;
  /** `pusd` or a CTF token id (decimal). */
  asset: string;
  /** Base units from the wallet's view: negative when it sent. */
  delta: bigint;
  block: bigint;
  txHash: Hex;
  logIndex: number;
}

/** Polygon log reader for the indexer: pUSD and CTF transfers touching the given wallets. */
export interface PolygonLogs {
  /** Latest block to scan to (a few confirmations behind head). */
  head(): Promise<bigint>;
  transfers(from: bigint, to: bigint, wallets: Address[]): Promise<WalletTransfer[]>;
}
