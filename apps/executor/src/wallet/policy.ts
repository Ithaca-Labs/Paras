import { decodeFunctionData, getAddress, isAddressEqual, type Address, type Hex } from 'viem';
import { ctfAbi, erc20Abi, rampAbi, swapRouterAbi, tokenMessengerAbi } from './abi.js';
import type { Batch, Call } from './batch.js';
import { addressToBytes32 } from './calls.js';
import { CCTP_DOMAIN, POLYGON, USDC_SWAP_FEE } from './constants.js';

/**
 * Executor policy layer (option B, issue #36).
 *
 * Polymarket's DepositWallet does NOT scope session keys on-chain (spikes/17: a session signer can batch-call
 * any target except the wallet and beacon). So the Executor itself refuses to sign any batch outside this
 * allowlist: approve/wrap/unwrap/swap/redeem/CCTP-burn-to-Vault, plus CLOB order/cancel. Everything else is denied,
 * including every plain token transfer. On-chain enforcement arrives with option A (per-user PolicyOwner).
 */
export class PolicyViolation extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`policy: ${message}`);
    this.name = 'PolicyViolation';
  }
}

export interface PolicyContext {
  /** The user's own Deposit Wallet; the only wallet/recipient funds may flow to on Polygon. */
  wallet: Address;
  /** Paras Vault on Monad; the only external destination (via CCTP burn). */
  vault: Address;
  now: Date;
  /** Session key expiry; refuse to sign at/after it. */
  keyValidUntil: Date;
  /** Remaining funding (USDC base units) this Intent may bring into the wallet. */
  fundingRemaining: bigint;
  /** Max batch lifetime. Default 1h. */
  maxDeadlineSeconds?: number;
  /** Max swap slippage vs 1:1 in bps. Default 100 (1%). */
  maxSlippageBps?: number;
  maxCalls?: number;
}

export interface PolicyResult {
  /** USDC base units this batch funds into the wallet; add to the Intent's funded total once submitted. */
  funding: bigint;
}

const exchanges = [POLYGON.ctfExchange, POLYGON.negRiskExchange, POLYGON.v2Exchange];

/** token -> allowed approve spenders */
const approveSpenders = new Map<string, Address[]>([
  [POLYGON.usdcNative.toLowerCase(), [POLYGON.swapRouter02, POLYGON.tokenMessengerV2]],
  [POLYGON.usdcE.toLowerCase(), [POLYGON.swapRouter02, POLYGON.onramp]],
  [POLYGON.pUSD.toLowerCase(), [POLYGON.offramp, ...exchanges]],
]);

const eq = (a: Address, b: Address) => isAddressEqual(a, b);
const inList = (a: Address, list: Address[]) => list.some((x) => eq(a, x));
const deny = (code: string, msg: string): never => {
  throw new PolicyViolation(code, msg);
};

function decode<T extends Parameters<typeof decodeFunctionData>[0]['abi']>(abi: T, data: Hex) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return deny('unknown_selector', 'calldata does not match an allowed function');
  }
}

/** Throws `PolicyViolation` unless every call in the batch is allowlisted. Pure; no I/O. */
export function checkBatch(batch: Batch, ctx: PolicyContext): PolicyResult {
  const nowSec = BigInt(Math.floor(ctx.now.getTime() / 1000));
  if (!eq(batch.wallet, ctx.wallet)) deny('wrong_wallet', 'batch is for a different wallet');
  if (ctx.now >= ctx.keyValidUntil) deny('key_expired', 'session key expired');
  if (batch.deadline <= nowSec) deny('deadline_past', 'batch deadline already passed');
  if (batch.deadline > nowSec + BigInt(ctx.maxDeadlineSeconds ?? 3600))
    deny('deadline_far', 'batch deadline too far in the future');
  if (batch.calls.length === 0) deny('empty_batch', 'empty batch');
  if (batch.calls.length > (ctx.maxCalls ?? 16)) deny('too_many_calls', 'too many calls');

  let swapIn = 0n;
  let wrapped = 0n;
  for (const c of batch.calls) {
    const r = checkCall(c, ctx);
    swapIn += r.swapIn;
    wrapped += r.wrapped;
  }
  // A swap->wrap flow moves the same money twice; the larger side is what was funded.
  const funding = swapIn > wrapped ? swapIn : wrapped;
  if (funding > ctx.fundingRemaining) deny('funding_cap', 'exceeds per-Intent funding cap');
  return { funding };
}

function checkCall(c: Call, ctx: PolicyContext): { swapIn: bigint; wrapped: bigint } {
  const none = { swapIn: 0n, wrapped: 0n };
  if (c.value !== 0n) deny('native_value', 'native value transfers are not allowed');
  const target = c.target;
  if (eq(target, ctx.wallet)) deny('self_call', 'calls to the wallet itself are owner-only');

  const spenders = approveSpenders.get(target.toLowerCase());
  if (spenders) {
    const { functionName, args } = decode(erc20Abi, c.data);
    if (functionName !== 'approve')
      return deny('token_move', `${functionName} on a token is not allowed`);
    const [spender] = args as [Address, bigint];
    if (!inList(spender, spenders)) deny('spender', `approve to ${spender} not allowed`);
    return none;
  }

  if (eq(target, POLYGON.onramp) || eq(target, POLYGON.offramp)) {
    const { functionName, args } = decode(rampAbi, c.data);
    const [asset, to, amount] = args as [Address, Address, bigint];
    if (eq(target, POLYGON.onramp) !== (functionName === 'wrap'))
      deny('ramp_fn', 'wrong ramp function');
    if (!eq(asset, POLYGON.usdcE)) deny('ramp_asset', 'only USDC.e is wrapped/unwrapped');
    if (!eq(to, ctx.wallet)) deny('recipient', 'ramp recipient must be the wallet');
    return functionName === 'wrap' ? { swapIn: 0n, wrapped: amount } : none;
  }

  if (eq(target, POLYGON.swapRouter02)) {
    const { functionName, args } = decode(swapRouterAbi, c.data);
    if (functionName !== 'exactInputSingle') return deny('swap_fn', 'unsupported swap function');
    const [p] = args;
    const pair =
      (eq(p.tokenIn, POLYGON.usdcNative) && eq(p.tokenOut, POLYGON.usdcE)) ||
      (eq(p.tokenIn, POLYGON.usdcE) && eq(p.tokenOut, POLYGON.usdcNative));
    if (!pair) deny('swap_pair', 'only native USDC <-> USDC.e swaps');
    if (p.fee !== USDC_SWAP_FEE) deny('swap_fee', 'unexpected pool fee tier');
    if (!eq(p.recipient, ctx.wallet)) deny('recipient', 'swap recipient must be the wallet');
    const bps = BigInt(ctx.maxSlippageBps ?? 100);
    if (p.amountOutMinimum * 10_000n < p.amountIn * (10_000n - bps))
      deny('slippage', 'amountOutMinimum below slippage floor');
    return { swapIn: eq(p.tokenIn, POLYGON.usdcNative) ? p.amountIn : 0n, wrapped: 0n };
  }

  if (eq(target, POLYGON.tokenMessengerV2)) {
    const { functionName, args } = decode(tokenMessengerAbi, c.data);
    if (functionName !== 'depositForBurn') return deny('burn_fn', 'unsupported CCTP function');
    const [amount, domain, mintRecipient, burnToken, destCaller, maxFee] = args as [
      bigint,
      number,
      Hex,
      Address,
      Hex,
      bigint,
      number,
    ];
    const vault32 = addressToBytes32(ctx.vault).toLowerCase();
    if (domain !== CCTP_DOMAIN.monad) deny('burn_domain', 'burn must target Monad');
    if (mintRecipient.toLowerCase() !== vault32)
      deny('burn_recipient', 'mintRecipient must be the Vault');
    if (destCaller.toLowerCase() !== vault32)
      deny('burn_caller', 'destinationCaller must be the Vault');
    if (!eq(burnToken, POLYGON.usdcNative)) deny('burn_token', 'only native USDC is bridged');
    if (maxFee * 100n > amount) deny('burn_fee', 'maxFee above 1%');
    return none;
  }

  if (eq(target, POLYGON.ctf)) {
    const { functionName, args } = decode(ctfAbi, c.data);
    if (functionName === 'redeemPositions') {
      if (!eq(args[0] as Address, POLYGON.pUSD))
        deny('redeem_collateral', 'redeem collateral must be pUSD');
      return none;
    }
    const [operator, approved] = args as [Address, boolean];
    if (approved && !inList(operator, exchanges))
      deny('operator', 'CTF operator must be a Polymarket exchange');
    return none;
  }

  return deny('target', `target ${getAddress(target)} is not allowlisted`);
}

export type ClobAction =
  { kind: 'order'; maker: Address; signer: Address } | { kind: 'cancel'; maker: Address };

/** CLOB scope: the Executor may only place/cancel orders whose maker (and signer) is the user's wallet. */
export function checkClobAction(
  action: ClobAction,
  ctx: Pick<PolicyContext, 'wallet' | 'now' | 'keyValidUntil'>,
) {
  if (ctx.now >= ctx.keyValidUntil) deny('key_expired', 'session key expired');
  if (!eq(action.maker, ctx.wallet)) deny('clob_maker', 'order maker must be the user wallet');
  if (action.kind === 'order' && !eq(action.signer, ctx.wallet))
    deny('clob_signer', 'order signer must be the user wallet (POLY_1271)');
}
