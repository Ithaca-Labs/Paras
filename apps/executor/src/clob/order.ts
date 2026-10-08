import {
  encodeAbiParameters,
  hashDomain,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';

/** CLOB v2 `Order` (EIP-712) as the exchange hashes it. */
export interface V2Order {
  salt: bigint;
  maker: Address;
  signer: Address;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  /** 0 BUY, 1 SELL */
  side: 0 | 1;
  /** 3 = POLY_1271 (Deposit Wallet). */
  signatureType: 3;
  /** ms */
  timestamp: bigint;
  metadata: Hex;
  builder: Hex;
}

export const EXCHANGE_DOMAIN_NAME = 'Polymarket CTF Exchange';
export const ZERO32: Hex = `0x${'0'.repeat(64)}`;

export const ORDER_FIELDS = [
  { name: 'salt', type: 'uint256' },
  { name: 'maker', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'makerAmount', type: 'uint256' },
  { name: 'takerAmount', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'signatureType', type: 'uint8' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'builder', type: 'bytes32' },
] as const;

const ORDER_TYPE_HEX = toHex(
  'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)',
);

export interface ExchangeDomain {
  chainId: number;
  verifyingContract: Address;
  /** "2" for the V2 exchanges, "3" for the V3 exchange. */
  version: string;
}

/**
 * ERC-7739 "TypedDataSign" signature for a Deposit Wallet (POLY_1271): the session key signs the order nested in the
 * wallet's own domain, then the wallet gets `appDomainSeparator ++ contentsHash ++ orderType ++ len(orderType)` to
 * rebuild the digest. Layout mirrors Polymarket's `@polymarket/clob-client-v2` (golden vectors in the tests).
 */
export async function signPoly1271Order(
  key: LocalAccount,
  order: V2Order,
  d: ExchangeDomain,
): Promise<Hex> {
  const domain = {
    name: EXCHANGE_DOMAIN_NAME,
    version: d.version,
    chainId: d.chainId,
    verifyingContract: d.verifyingContract,
  };
  const inner = await key.signTypedData({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: {
      TypedDataSign: [
        { name: 'contents', type: 'Order' },
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' },
      ],
      Order: ORDER_FIELDS,
    },
    primaryType: 'TypedDataSign',
    message: {
      contents: order,
      name: 'DepositWallet',
      version: '1',
      chainId: BigInt(d.chainId),
      verifyingContract: order.signer,
      salt: ZERO32,
    },
  });
  const contentsHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, ...ORDER_FIELDS.map((f) => ({ type: f.type }))],
      [
        keccak256(ORDER_TYPE_HEX),
        order.salt,
        order.maker,
        order.signer,
        order.tokenId,
        order.makerAmount,
        order.takerAmount,
        order.side,
        order.signatureType,
        order.timestamp,
        order.metadata,
        order.builder,
      ],
    ),
  );
  const typeLen = (ORDER_TYPE_HEX.length - 2) / 2;
  const appDomainSeparator = hashDomain({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  });
  return `${inner}${appDomainSeparator.slice(2)}${contentsHash.slice(2)}${ORDER_TYPE_HEX.slice(2)}${typeLen.toString(16).padStart(4, '0')}`;
}

const U = 1_000_000n; // 6 decimals: USDC and shares

/** "0.55" -> 550000n. Rejects more than 6 decimals. */
export function toUnits(dec: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(dec);
  if (!m) throw new Error(`bad decimal ${dec}`);
  return BigInt(m[1]!) * U + BigInt((m[2] ?? '').padEnd(6, '0'));
}

export const fromUnits = (v: bigint): string => {
  const s = v.toString().padStart(7, '0');
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, '');
};

/**
 * BUY amounts: spend at most `amountUsd`, at `price` rounded down to the tick (never pays more than asked),
 * for a whole number of cents of shares (Polymarket size precision is 2 decimals).
 */
export function buyAmounts(amountUsd: string, price: string, tick: string) {
  const tickU = toUnits(tick);
  const priceU = (toUnits(price) / tickU) * tickU;
  if (priceU < tickU || priceU > U - tickU) throw new Error(`price ${price} outside tick range`);
  const takerAmount = ((toUnits(amountUsd) * 100n) / priceU) * 10_000n;
  if (takerAmount === 0n) throw new Error('amount too small for one share cent');
  return { makerAmount: (takerAmount * priceU) / U, takerAmount, price: fromUnits(priceU) };
}

/**
 * SELL amounts: sell a whole number of cents of shares (rounded down) for at least `price` each, with the price
 * rounded UP to the tick (never accepts less than asked). Maker gives shares, taker gives USDC.
 */
export function sellAmounts(shares: string, price: string, tick: string) {
  const tickU = toUnits(tick);
  const p = toUnits(price);
  const priceU = ((p + tickU - 1n) / tickU) * tickU;
  if (priceU < tickU || priceU > U - tickU) throw new Error(`price ${price} outside tick range`);
  const makerAmount = (toUnits(shares) / 10_000n) * 10_000n;
  if (makerAmount === 0n) throw new Error('amount too small for one share cent');
  return { makerAmount, takerAmount: (makerAmount * priceU) / U, price: fromUnits(priceU) };
}
