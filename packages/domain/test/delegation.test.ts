import { describe, expect, it } from 'vitest';
import {
  buildDelegationPolicy,
  checkDelegatedRequest,
  exitTypedData,
  intentTypedData,
  type DelegationScope,
} from '../src/index.js';

const scope: DelegationScope = {
  vault: '0x1111111111111111111111111111111111111111',
  chainId: 10143,
  wallet: '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa',
  maxIntent: 50_000_000n,
};
const intent = (
  over: Partial<{ amount: bigint; user: string; vault: string; chainId: number }> = {},
) => {
  const t = intentTypedData({
    vault: over.vault ?? scope.vault,
    chainId: over.chainId ?? scope.chainId,
    user: over.user ?? scope.wallet,
    id: `0x${'0'.repeat(64)}`,
    amount: over.amount ?? 10_000_000n,
    expiry: 2_000_000_000n,
    detailsHash: `0x${'1'.repeat(64)}`,
  });
  return {
    kind: 'typedData' as const,
    domain: t.domain,
    primaryType: t.primaryType,
    message: t.message as Record<string, unknown>,
  };
};

describe('delegation policy', () => {
  const p = buildDelegationPolicy(scope);

  it('pins Vault, chain, wallet, cap and the two Vault functions; lowercase addresses', () => {
    expect(p.chain_type).toBe('ethereum');
    const [intentRule, exitRule, txRule] = p.rules;
    expect(intentRule!.method).toBe('eth_signTypedData_v4');
    expect(intentRule!.conditions.map((c) => [c.field, c.operator, c.value])).toEqual([
      ['verifyingContract', 'eq', scope.vault],
      ['chainId', 'eq', 10143],
      ['user', 'eq', scope.wallet.toLowerCase()],
      ['amount', 'lte', '50000000'],
    ]);
    expect(exitRule!.conditions).toHaveLength(1);
    expect(txRule!.method).toBe('eth_sendTransaction');
    expect(txRule!.conditions.map((c) => [c.field, c.operator, c.value])).toEqual([
      ['to', 'eq', scope.vault],
      ['value', 'eq', '0'],
      ['function_name', 'in', ['submitIntent', 'cancelIntent']],
    ]);
    expect(p.rules.every((r) => r.action === 'ALLOW')).toBe(true);
  });
});

describe('checkDelegatedRequest', () => {
  it('allows an Intent within scope (case-insensitive addresses) and an Exit', () => {
    expect(checkDelegatedRequest(scope, intent())).toBeNull();
    const e = exitTypedData({
      user: scope.wallet.toLowerCase(),
      positionId: 'p',
      shares: 1n,
      minPrice: '0.5',
      returnTo: 'vault',
      deadline: 1n,
    });
    expect(
      checkDelegatedRequest(scope, {
        kind: 'typedData',
        domain: e.domain as never,
        primaryType: 'Exit',
        message: e.message,
      }),
    ).toBeNull();
  });

  it.each([
    ['over per-intent max', intent({ amount: 50_000_001n }), 'over_intent_cap'],
    ['zero amount', intent({ amount: 0n }), 'bad_amount'],
    [
      'other verifying contract',
      intent({ vault: '0x3333333333333333333333333333333333333333' }),
      'verifying_contract_not_vault',
    ],
    ['other chain', intent({ chainId: 1 }), 'wrong_chain'],
    [
      'someone else as user',
      intent({ user: '0x4444444444444444444444444444444444444444' }),
      'user_not_wallet',
    ],
    ['unknown primary type', { ...intent(), primaryType: 'Permit' }, 'primary_type_not_allowed'],
  ])('refuses typed data: %s', (_n, req, reason) => {
    expect(checkDelegatedRequest(scope, req)).toBe(reason);
  });

  it.each([
    [
      'to elsewhere',
      {
        to: '0x3333333333333333333333333333333333333333',
        value: 0n,
        fn: 'submitIntent',
        chainId: 10143,
      },
      'to_not_vault',
    ],
    [
      'with value',
      { to: scope.vault, value: 1n, fn: 'submitIntent', chainId: 10143 },
      'value_not_zero',
    ],
    [
      'withdraw',
      { to: scope.vault, value: 0n, fn: 'withdraw', chainId: 10143 },
      'function_not_allowed',
    ],
    ['other chain', { to: scope.vault, value: 0n, fn: 'cancelIntent', chainId: 1 }, 'wrong_chain'],
  ])('refuses tx: %s', (_n, tx, reason) => {
    expect(checkDelegatedRequest(scope, { kind: 'tx', ...tx })).toBe(reason);
  });

  it('allows cancelIntent', () => {
    expect(
      checkDelegatedRequest(scope, {
        kind: 'tx',
        to: scope.vault.toUpperCase().replace('0X', '0x'),
        value: 0n,
        fn: 'cancelIntent',
        chainId: 10143,
      }),
    ).toBeNull();
  });
});
