import { createTestIndexer } from 'envio';
import { expect, it } from 'vitest';

const USER = '0xAbCdEf0000000000000000000000000000000001';
const ID = `0x${'11'.repeat(32)}`;
const WALLET = '0x00000000000000000000000000000000000000Aa';

it('maps Vault events to VaultActivity rows', async () => {
  const indexer = createTestIndexer();
  await indexer.process({
    chains: {
      10143: {
        startBlock: 1,
        simulate: [
          { contract: 'Vault', event: 'Deposited', params: { user: USER, amount: 5_000_000n } },
          { contract: 'Vault', event: 'Withdrawn', params: { user: USER, amount: 1_000_000n } },
          {
            contract: 'Vault',
            event: 'DepositWalletRegistered',
            params: { user: USER, wallet: WALLET },
          },
          {
            contract: 'Vault',
            event: 'IntentSubmitted',
            params: { user: USER, id: ID, amount: 2_000_000n, expiry: 99n, detailsHash: ID },
          },
          {
            contract: 'Vault',
            event: 'Settled',
            params: { user: USER, wallet: WALLET, amount: 1_900_000n, intentId: ID },
          },
          {
            contract: 'Vault',
            event: 'IntentClosed',
            params: { user: USER, id: ID, writtenOff: 100_000n },
          },
        ],
      },
    },
  });
  const rows = await indexer.VaultActivity.getAll();
  const by = (k: string) => rows.find((r) => r.kind === k);
  expect(rows).toHaveLength(6);
  expect(by('deposit')).toMatchObject({ user: USER.toLowerCase(), amount: '5000000' });
  expect(by('withdrawal')?.amount).toBe('1000000');
  expect(by('wallet_registered')?.wallet).toBe(WALLET.toLowerCase());
  expect(by('intent_submitted')).toMatchObject({ intentId: ID, amount: '2000000' });
  expect(by('settled')).toMatchObject({ amount: '1900000', intentId: ID });
  expect(by('intent_closed')?.amount).toBe('100000');
  expect(new Set(rows.map((r) => r.id)).size).toBe(6);
});
