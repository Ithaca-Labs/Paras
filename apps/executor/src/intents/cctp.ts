import type { Hex } from 'viem';

// CCTP v2 MessageV2: 148-byte header, then BurnMessageV2 body (amount at body+68, feeExecuted at body+164).
const HEADER = 148;
const slice = (m: Hex, from: number, to: number) => `0x${m.slice(2 + from * 2, 2 + to * 2)}` as Hex;

/** Message nonce (header bytes 12..44); the MessageTransmitter's `usedNonces` key. */
export const messageNonce = (m: Hex): Hex => slice(m, 12, 44);

/** USDC the mint delivers: burned amount minus the fee taken on the destination. */
export const mintedAmount = (m: Hex): bigint =>
  BigInt(slice(m, HEADER + 68, HEADER + 100)) - BigInt(slice(m, HEADER + 164, HEADER + 196));
