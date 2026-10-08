import { encodeFunctionData, pad, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { erc20Abi, tokenMessengerAbi } from '../../src/wallet/abi.js';
import type { Batch, Call } from '../../src/wallet/batch.js';
import {
  addressToBytes32,
  approve,
  authorizeSessionSigner,
  burnToVault,
  buildSweepCalls,
  redeemPositions,
  setCtfApproval,
  swapUsdc,
  unwrapToUsdcE,
  wrapUsdcE,
} from '../../src/wallet/calls.js';
import { CCTP_DOMAIN, POLYGON } from '../../src/wallet/constants.js';
import {
  checkBatch,
  checkClobAction,
  PolicyViolation,
  type PolicyContext,
} from '../../src/wallet/policy.js';

const wallet: Address = '0x1111111111111111111111111111111111111111';
const vault: Address = '0x2222222222222222222222222222222222222222';
const attacker: Address = '0x000000000000000000000000000000000000bEEF';
const now = new Date('2026-10-09T12:00:00Z');
const nowSec = BigInt(Math.floor(now.getTime() / 1000));

const ctx = (o: Partial<PolicyContext> = {}): PolicyContext => ({
  wallet,
  vault,
  now,
  keyValidUntil: new Date(now.getTime() + 86_400_000),
  fundingRemaining: 1_000_000_000n,
  ...o,
});
const batch = (calls: Call[], o: Partial<Batch> = {}): Batch => ({
  wallet,
  nonce: 1n,
  deadline: nowSec + 600n,
  calls,
  ...o,
});
const rejects = (b: Batch, code: string, c = ctx()) => {
  try {
    checkBatch(b, c);
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyViolation);
    expect((e as PolicyViolation).code).toBe(code);
    return;
  }
  throw new Error(`expected policy violation ${code}`);
};

const AMT = 100_000_000n; // 100 USDC

describe('Executor policy: allowed', () => {
  it('buy path: approve, swap native->USDC.e, approve, wrap', () => {
    const r = checkBatch(
      batch([
        approve(POLYGON.usdcNative, POLYGON.swapRouter02, AMT),
        swapUsdc('nativeToE', wallet, AMT, AMT - 1_000_000n),
        approve(POLYGON.usdcE, POLYGON.onramp, AMT),
        wrapUsdcE(wallet, AMT - 1_000_000n),
      ]),
      ctx(),
    );
    expect(r.funding).toBe(AMT);
  });

  it('sweep-back to the Vault, redeem, exchange approvals', () => {
    expect(
      checkBatch(
        batch(buildSweepCalls({ wallet, vault, pusdAmount: AMT, minNative: AMT - 500_000n })),
        ctx(),
      ).funding,
    ).toBe(0n);
    checkBatch(batch([redeemPositions(pad('0x01', { size: 32 }), [1n, 2n])]), ctx());
    checkBatch(
      batch([
        setCtfApproval(POLYGON.v2Exchange, true),
        approve(POLYGON.pUSD, POLYGON.ctfExchange, AMT),
      ]),
      ctx(),
    );
  });

  it('CLOB order/cancel only for the user wallet', () => {
    checkClobAction({ kind: 'order', maker: wallet, signer: wallet }, ctx());
    checkClobAction({ kind: 'cancel', maker: wallet }, ctx());
    expect(() =>
      checkClobAction({ kind: 'order', maker: attacker, signer: wallet }, ctx()),
    ).toThrow(PolicyViolation);
    expect(() =>
      checkClobAction({ kind: 'order', maker: wallet, signer: attacker }, ctx()),
    ).toThrow(PolicyViolation);
    expect(() =>
      checkClobAction({ kind: 'cancel', maker: wallet }, ctx({ keyValidUntil: now })),
    ).toThrow(PolicyViolation);
  });
});

describe('Executor policy: negative (session key cannot move funds to arbitrary addresses)', () => {
  const transfer = (token: Address, to: Address, amt: bigint): Call => ({
    target: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amt] }),
  });

  it.each([POLYGON.pUSD, POLYGON.usdcNative, POLYGON.usdcE])(
    'refuses ERC-20 transfer to attacker on %s',
    (token) => {
      rejects(batch([transfer(token, attacker, AMT)]), 'token_move');
    },
  );

  it('refuses transferFrom', () => {
    rejects(
      batch([
        {
          target: POLYGON.pUSD,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transferFrom',
            args: [wallet, attacker, AMT],
          }),
        },
      ]),
      'token_move',
    );
  });

  it('refuses approve to a non-allowlisted spender (incl. wrong spender for the token)', () => {
    rejects(batch([approve(POLYGON.pUSD, attacker, AMT)]), 'spender');
    rejects(batch([approve(POLYGON.usdcNative, POLYGON.onramp, AMT)]), 'spender');
  });

  it('refuses setApprovalForAll to a non-exchange operator', () => {
    rejects(batch([setCtfApproval(attacker, true)]), 'operator');
  });

  it('refuses wrap/unwrap/swap with a recipient other than the wallet', () => {
    rejects(batch([wrapUsdcE(attacker, AMT)]), 'recipient');
    rejects(batch([unwrapToUsdcE(attacker, AMT)]), 'recipient');
    rejects(batch([swapUsdc('eToNative', attacker, AMT, AMT)]), 'recipient');
  });

  it('refuses a swap without slippage protection', () => {
    rejects(batch([swapUsdc('nativeToE', wallet, AMT, 0n)]), 'slippage');
    rejects(batch([swapUsdc('nativeToE', wallet, AMT, AMT / 2n)]), 'slippage');
  });

  it('refuses CCTP burns not minting to the Vault on Monad', () => {
    rejects(batch([burnToVault(attacker, AMT)]), 'burn_recipient');
    const good = burnToVault(vault, AMT);
    const swapCaller = {
      ...good,
      data: encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: 'depositForBurn',
        args: [
          AMT,
          CCTP_DOMAIN.monad,
          addressToBytes32(vault),
          POLYGON.usdcNative,
          addressToBytes32(attacker),
          0n,
          2000,
        ],
      }),
    };
    rejects(batch([swapCaller]), 'burn_caller');
    const otherDomain = {
      ...good,
      data: encodeFunctionData({
        abi: tokenMessengerAbi,
        functionName: 'depositForBurn',
        args: [
          AMT,
          0,
          addressToBytes32(vault),
          POLYGON.usdcNative,
          addressToBytes32(vault),
          0n,
          2000,
        ],
      }),
    };
    rejects(batch([otherDomain]), 'burn_domain');
  });

  it('refuses native value, self-calls, unknown targets and selectors', () => {
    rejects(batch([{ ...approve(POLYGON.pUSD, POLYGON.offramp, 1n), value: 1n }]), 'native_value');
    rejects(
      batch([
        { target: wallet, value: 0n, data: authorizeSessionSigner(wallet, attacker, 1n).data },
      ]),
      'self_call',
    );
    rejects(batch([{ target: attacker, value: 0n, data: '0x' }]), 'target');
    rejects(batch([{ target: POLYGON.pUSD, value: 0n, data: '0xdeadbeef' }]), 'unknown_selector');
    rejects(batch([{ target: POLYGON.onramp, value: 0n, data: '0x' }]), 'unknown_selector');
  });

  it('refuses a whole batch if any one call is bad', () => {
    rejects(
      batch([approve(POLYGON.pUSD, POLYGON.offramp, AMT), transfer(POLYGON.pUSD, attacker, 1n)]),
      'token_move',
    );
  });

  it('refuses wrong wallet, stale/far deadline, empty and oversized batches', () => {
    const ok = approve(POLYGON.pUSD, POLYGON.offramp, 1n);
    rejects(batch([ok], { wallet: attacker }), 'wrong_wallet');
    rejects(batch([ok], { deadline: nowSec - 1n }), 'deadline_past');
    rejects(batch([ok], { deadline: nowSec + 86_400n }), 'deadline_far');
    rejects(batch([]), 'empty_batch');
    rejects(batch(Array.from({ length: 17 }, () => ok)), 'too_many_calls');
  });

  it('refuses after session key expiry', () => {
    rejects(
      batch([approve(POLYGON.pUSD, POLYGON.offramp, 1n)]),
      'key_expired',
      ctx({ keyValidUntil: now }),
    );
  });

  it('enforces the per-Intent funding cap', () => {
    const buy = batch([swapUsdc('nativeToE', wallet, AMT, AMT - 1_000_000n)]);
    checkBatch(buy, ctx({ fundingRemaining: AMT }));
    rejects(buy, 'funding_cap', ctx({ fundingRemaining: AMT - 1n }));
    rejects(batch([wrapUsdcE(wallet, AMT)]), 'funding_cap', ctx({ fundingRemaining: 0n }));
  });
});
