import { createAdapterRegistry, createPolymarketAdapter } from '@paras/adapters';
import { createDb } from '@paras/db';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildApp } from './app.js';
import { HttpClob } from './clob/client.js';
import { loadConfig } from './config.js';
import { createBookSource } from './intents/books.js';
import { createGeoblock, createIris, createPolygon } from './intents/clients.js';
import { IntentEngine } from './intents/engine.js';
import { createRunner } from './intents/runner.js';
import { createMonad } from './vault/chain.js';
import { EnvKeyCipher } from './wallet/key-cipher.js';
import { HttpRelayerClient } from './wallet/relayer.js';
import { WalletService } from './wallet/service.js';
import { syncWalletRequests } from './wallet/sync.js';

const config = loadConfig();
const app = buildApp({ logger: { level: config.LOG_LEVEL } });
const stops: (() => Promise<unknown>)[] = [() => app.close()];

if (config.EXECUTOR_INTENTS_ENABLED) {
  const need = <T>(v: T | undefined, name: string): T => {
    if (v === undefined) throw new Error(`${name} is required when EXECUTOR_INTENTS_ENABLED=true`);
    return v;
  };
  const databaseUrl = need(config.DATABASE_URL, 'DATABASE_URL');
  const account = privateKeyToAccount(
    need(config.EXECUTOR_PRIVATE_KEY, 'EXECUTOR_PRIVATE_KEY') as `0x${string}`,
  );
  const { db, close } = createDb(databaseUrl);
  const monad = createMonad({
    transport: http(need(config.MONAD_RPC_URL, 'MONAD_RPC_URL')),
    chainId: need(config.VAULT_CHAIN_ID, 'VAULT_CHAIN_ID'),
    account,
    vault: need(config.VAULT_ADDRESS, 'VAULT_ADDRESS') as `0x${string}`,
    messageTransmitter: config.MONAD_MESSAGE_TRANSMITTER as `0x${string}`,
    fromBlock: BigInt(config.VAULT_START_BLOCK),
  });
  const polygon = createPolygon({
    transport: http(need(config.POLYGON_RPC_URL, 'POLYGON_RPC_URL')),
    account,
  });
  const relayer = new HttpRelayerClient({
    baseUrl: config.POLYMARKET_RELAYER_URL,
    creds: {
      apiKey: need(config.POLYMARKET_BUILDER_API_KEY, 'POLYMARKET_BUILDER_API_KEY'),
      secret: need(config.POLYMARKET_BUILDER_SECRET, 'POLYMARKET_BUILDER_SECRET'),
      passphrase: need(config.POLYMARKET_BUILDER_PASSPHRASE, 'POLYMARKET_BUILDER_PASSPHRASE'),
    },
  });
  const wallets = new WalletService({
    db,
    cipher: new EnvKeyCipher(need(config.EXECUTOR_MASTER_KEY, 'EXECUTOR_MASTER_KEY')),
    relayer,
    chain: polygon,
    vault: monad.registry,
  });
  const engine = new IntentEngine({
    db,
    wallets,
    relayer,
    vault: monad.chain,
    polygon,
    iris: createIris({ baseUrl: config.IRIS_URL }),
    clob: new HttpClob({
      baseUrl: config.POLYMARKET_CLOB_URL,
      builderCode: need(config.POLYMARKET_BUILDER_CODE, 'POLYMARKET_BUILDER_CODE') as `0x${string}`,
      sessionKey: (w) => wallets.sessionAccount(w),
    }),
    books: createBookSource(db, createAdapterRegistry([createPolymarketAdapter()])),
    geoblock: createGeoblock(),
  });
  const log = (msg: string, data?: object) => app.log.info(data, msg);
  const runner = createRunner({
    db,
    databaseUrl,
    vault: monad.chain,
    engine,
    startBlock: BigInt(config.VAULT_START_BLOCK),
    onTick: () => syncWalletRequests(db, wallets, log),
    log,
  });
  await runner.start();
  stops.push(() => runner.stop(), close);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void Promise.all(stops.map((s) => s())));

await app.listen({ port: config.EXECUTOR_PORT, host: '0.0.0.0' });
