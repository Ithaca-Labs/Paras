/** One-time: `pnpm tsx src/vault/provision-privy.ts` -> prints the wallet to fund and the env to set. */
import { loadConfig } from '../config.js';
import { createPrivy, provisionExecutorWallet } from './privy.js';

const c = loadConfig();
if (!c.PRIVY_APP_ID || !c.PRIVY_APP_SECRET || !c.VAULT_ADDRESS || !c.VAULT_CHAIN_ID)
  throw new Error('PRIVY_APP_ID, PRIVY_APP_SECRET, VAULT_ADDRESS, VAULT_CHAIN_ID required');
const r = await provisionExecutorWallet(
  createPrivy({ appId: c.PRIVY_APP_ID, appSecret: c.PRIVY_APP_SECRET }),
  { vault: c.VAULT_ADDRESS as `0x${string}`, chainId: c.VAULT_CHAIN_ID },
);
console.log(`PRIVY_EXECUTOR_WALLET_ID=${r.walletId}\nfund + grant EXECUTOR_ROLE to ${r.address}`);
