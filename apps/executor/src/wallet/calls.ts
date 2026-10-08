import { encodeFunctionData, pad, type Address, type Hex } from 'viem';
import {
  ctfAbi,
  depositWalletAbi,
  erc20Abi,
  rampAbi,
  swapRouterAbi,
  tokenMessengerAbi,
} from './abi.js';
import type { Call } from './batch.js';
import { CCTP_DOMAIN, POLYGON, USDC_SWAP_FEE } from './constants.js';

const call = (target: Address, data: Hex): Call => ({ target, value: 0n, data });

/** CCTP `bytes32` form of an EVM address. */
export const addressToBytes32 = (addr: Address): Hex => pad(addr, { size: 32 });

export const approve = (token: Address, spender: Address, amount: bigint): Call =>
  call(
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
  );

export const wrapUsdcE = (to: Address, amount: bigint): Call =>
  call(
    POLYGON.onramp,
    encodeFunctionData({ abi: rampAbi, functionName: 'wrap', args: [POLYGON.usdcE, to, amount] }),
  );

export const unwrapToUsdcE = (to: Address, amount: bigint): Call =>
  call(
    POLYGON.offramp,
    encodeFunctionData({ abi: rampAbi, functionName: 'unwrap', args: [POLYGON.usdcE, to, amount] }),
  );

/** Native USDC <-> USDC.e on Uniswap V3 (fee 100). `minOut` is mandatory slippage protection. */
export function swapUsdc(
  dir: 'nativeToE' | 'eToNative',
  recipient: Address,
  amountIn: bigint,
  minOut: bigint,
): Call {
  const [tokenIn, tokenOut] =
    dir === 'nativeToE' ? [POLYGON.usdcNative, POLYGON.usdcE] : [POLYGON.usdcE, POLYGON.usdcNative];
  return call(
    POLYGON.swapRouter02,
    encodeFunctionData({
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee: USDC_SWAP_FEE,
          recipient,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
  );
}

/** CCTP v2 burn on Polygon back to the Vault (Monad). `mintRecipient = destinationCaller = Vault`. */
export const burnToVault = (
  vault: Address,
  amount: bigint,
  maxFee = 0n,
  minFinality = 2000,
): Call =>
  call(
    POLYGON.tokenMessengerV2,
    encodeFunctionData({
      abi: tokenMessengerAbi,
      functionName: 'depositForBurn',
      args: [
        amount,
        CCTP_DOMAIN.monad,
        addressToBytes32(vault),
        POLYGON.usdcNative,
        addressToBytes32(vault),
        maxFee,
        minFinality,
      ],
    }),
  );

export const redeemPositions = (conditionId: Hex, indexSets: bigint[]): Call =>
  call(
    POLYGON.ctf,
    encodeFunctionData({
      abi: ctfAbi,
      functionName: 'redeemPositions',
      args: [POLYGON.pUSD, pad('0x00', { size: 32 }), conditionId, indexSets],
    }),
  );

export const setCtfApproval = (operator: Address, approved: boolean): Call =>
  call(
    POLYGON.ctf,
    encodeFunctionData({
      abi: ctfAbi,
      functionName: 'setApprovalForAll',
      args: [operator, approved],
    }),
  );

/** Owner-only batch calls (signed by the user's EOA, never by the Executor). */
export const authorizeSessionSigner = (
  wallet: Address,
  signer: Address,
  validUntil: bigint,
): Call =>
  call(
    wallet,
    encodeFunctionData({
      abi: depositWalletAbi,
      functionName: 'authorizeSessionSigner',
      args: [signer, validUntil],
    }),
  );

export const revokeSessionSigner = (wallet: Address, signer: Address): Call =>
  call(
    wallet,
    encodeFunctionData({
      abi: depositWalletAbi,
      functionName: 'revokeSessionSigner',
      args: [signer],
    }),
  );

/**
 * Funding: CCTP-minted native USDC -> USDC.e -> pUSD, then let `exchange` spend the pUSD. One batch (PRD 2c).
 * `minOut` is the swap floor and the wrapped amount; any surplus USDC.e stays in the wallet as dust.
 */
export function buildConvertCalls(p: {
  wallet: Address;
  exchange: Address;
  amount: bigint;
  minOut: bigint;
}): Call[] {
  return [
    approve(POLYGON.usdcNative, POLYGON.swapRouter02, p.amount),
    swapUsdc('nativeToE', p.wallet, p.amount, p.minOut),
    approve(POLYGON.usdcE, POLYGON.onramp, p.minOut),
    wrapUsdcE(p.wallet, p.minOut),
    approve(POLYGON.pUSD, p.exchange, p.minOut),
  ];
}

/**
 * Sweep-back: pUSD -> USDC.e -> native USDC -> CCTP burn to the user's Vault account.
 * `minNative` is the slippage floor of the swap. All calls pass the Executor policy.
 */
export function buildSweepCalls(p: {
  wallet: Address;
  vault: Address;
  pusdAmount: bigint;
  minNative: bigint;
}): Call[] {
  return [
    approve(POLYGON.pUSD, POLYGON.offramp, p.pusdAmount),
    unwrapToUsdcE(p.wallet, p.pusdAmount),
    approve(POLYGON.usdcE, POLYGON.swapRouter02, p.pusdAmount),
    swapUsdc('eToNative', p.wallet, p.pusdAmount, p.minNative),
    approve(POLYGON.usdcNative, POLYGON.tokenMessengerV2, p.minNative),
    burnToVault(p.vault, p.minNative),
  ];
}
