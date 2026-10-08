import { describe, expect, it } from 'vitest';
import { createKeyCipher, EnvKeyCipher } from '../../src/wallet/key-cipher.js';
import { builderHeaders, HttpRelayerClient } from '../../src/wallet/relayer.js';

describe('key cipher', () => {
  const c = new EnvKeyCipher('ab'.repeat(32));
  it('round-trips, binds to aad, rejects tampering and wrong master key', async () => {
    const ct = await c.encrypt('secret', 'a');
    expect(await c.decrypt(ct, 'a')).toBe('secret');
    await expect(c.decrypt(ct, 'b')).rejects.toThrow();
    await expect(c.decrypt(ct.slice(0, -2) + 'AA', 'a')).rejects.toThrow();
    await expect(new EnvKeyCipher('cd'.repeat(32)).decrypt(ct, 'a')).rejects.toThrow();
  });
  it('mainnet requires KMS (stubbed); env backend needs a valid master key', async () => {
    expect(() =>
      createKeyCipher({
        EXECUTOR_NETWORK: 'mainnet',
        EXECUTOR_KEY_BACKEND: 'env',
        EXECUTOR_MASTER_KEY: 'ab'.repeat(32),
      }),
    ).toThrow(/kms/);
    await expect(
      createKeyCipher({ EXECUTOR_NETWORK: 'mainnet', EXECUTOR_KEY_BACKEND: 'kms' }).encrypt(
        'x',
        'y',
      ),
    ).rejects.toThrow(/not implemented/);
    expect(() =>
      createKeyCipher({
        EXECUTOR_NETWORK: 'testnet',
        EXECUTOR_KEY_BACKEND: 'env',
        EXECUTOR_MASTER_KEY: 'zz',
      }),
    ).toThrow();
  });
});

describe('http relayer (mocked fetch; live calls are env-gated under #35)', () => {
  const creds = { apiKey: 'k', secret: Buffer.from('s').toString('base64'), passphrase: 'p' };
  it('signs builder headers deterministically', () => {
    const a = builderHeaders(creds, 1, 'POST', '/submit', '{}');
    expect(a).toEqual(builderHeaders(creds, 1, 'POST', '/submit', '{}'));
    expect(a.POLY_BUILDER_SIGNATURE).not.toBe(
      builderHeaders(creds, 2, 'POST', '/submit', '{}').POLY_BUILDER_SIGNATURE,
    );
  });
  it('posts WALLET-CREATE and polls to confirmation', async () => {
    const calls: string[] = [];
    const states = ['STATE_NEW', 'STATE_CONFIRMED'];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      const body = url.includes('/transaction')
        ? { state: states.shift() }
        : { transactionID: 'tx1' };
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;
    const r = new HttpRelayerClient({ baseUrl: 'http://r', creds, fetch: fakeFetch, pollMs: 1 });
    const { txId } = await r.deployWallet({
      owner: '0x1111111111111111111111111111111111111111',
      salt: '0x00',
    });
    await r.waitConfirmed(txId);
    expect(calls).toEqual([
      'POST http://r/submit',
      'GET http://r/transaction?id=tx1',
      'GET http://r/transaction?id=tx1',
    ]);
  });
});
