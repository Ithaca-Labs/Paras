import { createAdapterRegistry, createPolymarketAdapter } from '@paras/adapters';
import { createDb } from '@paras/db';
import { createPublicClient, http, parseAbi, parseEventLogs, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildApp } from './app.js';
import { grantDemoSessionKeys } from './demo/keys.js';
import { createDemoSim } from './demo/sim.js';
import { HttpClob } from './clob/client.js';
import { loadConfig } from './config.js';
import { createBookSource } from './intents/books.js';
import { ExitEngine, scanResolved } from './exits/engine.js';
import { indexPolygon } from './indexer/polygon.js';
import { createGeoblock, createIris, createPolygon, createPolygonLogs } from './intents/clients.js';
import { IntentEngine } from './intents/engine.js';
import { createRunner } from './intents/runner.js';
import { createMonad } from './vault/chain.js';
import { createPrivy, privyExecutorAccount } from './vault/privy.js';
import { EnvKeyCipher } from './wallet/key-cipher.js';
import { HttpRelayerClient } from './wallet/relayer.js';
import { WalletService } from './wallet/service.js';
import { syncWalletRequests } from './wallet/sync.js';

/** The DemoCctp `DemoBurn` behind a Vault dispatch tx (what the real Iris reads off the CCTP message). */
const demoBurnOf = (rpc: string) => {
  const pub = createPublicClient({ transport: http(rpc) });
  const abi = parseAbi([
    'event DemoBurn(address indexed burner, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient)',
  ]);
  return async (tx: Hex) => {
    const receipt = await pub.getTransactionReceipt({ hash: tx }).catch(() => null);
    const [burn] = receipt ? parseEventLogs({ abi, logs: receipt.logs }) : [];
    return burn ? { amount: burn.args.amount, mintRecipient: burn.args.mintRecipient } : null;
  };
};

const config = loadConfig();
const demo = config.EXECUTOR_DEMO_MODE === 'simulate';
const app = buildApp({ logger: { level: config.LOG_LEVEL } }, { demo });
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
  // Polygon (CLOB/relayer) keeps the env key; only Monad Vault txs move to Privy.
  const monadAccount =
    config.EXECUTOR_MONAD_SIGNER === 'privy'
      ? await privyExecutorAccount(
          createPrivy({
            appId: need(config.PRIVY_APP_ID, 'PRIVY_APP_ID'),
            appSecret: need(config.PRIVY_APP_SECRET, 'PRIVY_APP_SECRET'),
          }),
          need(config.PRIVY_EXECUTOR_WALLET_ID, 'PRIVY_EXECUTOR_WALLET_ID'),
        )
      : account;
  const { db, close } = createDb(databaseUrl);
  const monad = createMonad({
    transport: http(need(config.MONAD_RPC_URL, 'MONAD_RPC_URL')),
    chainId: need(config.VAULT_CHAIN_ID, 'VAULT_CHAIN_ID'),
    account: monadAccount,
    vault: need(config.VAULT_ADDRESS, 'VAULT_ADDRESS') as `0x${string}`,
    messageTransmitter: config.MONAD_MESSAGE_TRANSMITTER as `0x${string}`,
    fromBlock: BigInt(config.VAULT_START_BLOCK),
  });
  // Testnet demo (#98): the Polymarket leg is simulated behind the same ports; the Vault stays real.
  const sim = demo
    ? createDemoSim({
        attester: account,
        cctp: config.MONAD_MESSAGE_TRANSMITTER as Address,
        vault: config.VAULT_ADDRESS as Address,
        db,
        burnOf: demoBurnOf(need(config.MONAD_RPC_URL, 'MONAD_RPC_URL')),
        clobUrl: config.POLYMARKET_CLOB_URL,
      })
    : undefined;
  if (demo) app.log.warn('EXECUTOR_DEMO_MODE=simulate: Polymarket leg is SIMULATED (testnet demo)');
  const polygon =
    sim?.polygon ??
    createPolygon({ transport: http(need(config.POLYGON_RPC_URL, 'POLYGON_RPC_URL')), account });
  const relayer =
    sim?.relayer ??
    new HttpRelayerClient({
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
  const iris = sim?.iris ?? createIris({ baseUrl: config.IRIS_URL });
  const clob =
    sim?.clob ??
    new HttpClob({
      baseUrl: config.POLYMARKET_CLOB_URL,
      builderCode: need(config.POLYMARKET_BUILDER_CODE, 'POLYMARKET_BUILDER_CODE') as `0x${string}`,
      sessionKey: (w) => wallets.sessionAccount(w),
    });
  const geoblock = sim ? { allowed: async () => true } : createGeoblock();
  const engine = new IntentEngine({
    db,
    wallets,
    relayer,
    vault: monad.chain,
    polygon,
    iris,
    clob,
    books: createBookSource(db, createAdapterRegistry([createPolymarketAdapter()])),
    geoblock,
  });
  const exitEngine = new ExitEngine({
    db,
    wallets,
    relayer,
    vault: monad.chain,
    polygon,
    iris,
    clob,
    geoblock,
  });
  const logs = sim
    ? undefined
    : createPolygonLogs({ transport: http(need(config.POLYGON_RPC_URL, 'POLYGON_RPC_URL')) });
  const log = (msg: string, data?: object) => app.log.info(data, msg);
  const runner = createRunner({
    db,
    databaseUrl,
    vault: monad.chain,
    engine,
    exitEngine,
    startBlock: BigInt(config.VAULT_START_BLOCK),
    onTick: async () => {
      await syncWalletRequests(db, wallets, log);
      if (!logs) return grantDemoSessionKeys(db, wallets); // demo: no Polygon to index or redeem
      await indexPolygon(
        db,
        logs,
        config.POLYGON_START_BLOCK === undefined ? undefined : BigInt(config.POLYGON_START_BLOCK),
      );
      await scanResolved(db, polygon);
    },
    log,
  });
  await runner.start();
  stops.push(() => runner.stop(), close);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void Promise.all(stops.map((s) => s())));

await app.listen({ port: config.EXECUTOR_PORT, host: '0.0.0.0' });
