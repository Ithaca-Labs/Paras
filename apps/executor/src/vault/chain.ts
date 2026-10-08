import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type Transport,
} from 'viem';
import { messageNonce } from '../intents/cctp.js';
import type { VaultChain, VaultEvent } from '../intents/ports.js';
import type { VaultRegistry } from '../wallet/service.js';
import {
  messageTransmitterAbi,
  vaultAbi,
  vaultDispatchedEvent,
  vaultIntentEvents,
} from './abi.js';

export interface MonadOptions {
  transport: Transport;
  chainId: number;
  /** The Executor key (holds EXECUTOR_ROLE on the Vault). */
  account: LocalAccount;
  vault: Address;
  /** CCTP MessageTransmitterV2 on Monad. */
  messageTransmitter: Address;
  /** Vault deploy block: lower bound for log scans. */
  fromBlock?: bigint;
  /** Receipt polling interval (ms). Default 4000. */
  pollingMs?: number;
  /** Blocks behind head before an event counts. Default 2. */
  confirmations?: bigint;
}

const MAX_RANGE = 2000n;

/** Executor-side Monad access: the Vault port the engine uses and the `VaultRegistry` the wallet service uses. */
export function createMonad(o: MonadOptions): { chain: VaultChain; registry: VaultRegistry } {
  const monad = defineChain({
    id: o.chainId,
    name: 'monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
  const pub = createPublicClient({ chain: monad, transport: o.transport, pollingInterval: o.pollingMs });
  const wallet = createWalletClient({ chain: monad, transport: o.transport, account: o.account });

  const mined = async (hash: Hex): Promise<Hex> => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`tx ${hash} reverted`);
    return hash;
  };
  const vault = o.vault;

  const chain: VaultChain = {
    address: vault,
    async events(from) {
      const head = (await pub.getBlockNumber()) - (o.confirmations ?? 2n);
      if (head < from) return { events: [], toBlock: from - 1n };
      const toBlock = head < from + MAX_RANGE ? head : from + MAX_RANGE - 1n;
      const logs = await pub.getLogs({
        address: vault,
        fromBlock: from,
        toBlock,
        events: vaultIntentEvents,
      });
      const events: VaultEvent[] = logs.map((l) => {
        const { user, id } = l.args;
        const block = l.blockNumber;
        if (l.eventName === 'IntentSubmitted') {
          const { amount, expiry, detailsHash } = l.args;
          return { kind: 'submitted', user, id, amount, expiry, detailsHash, block } as VaultEvent;
        }
        return { kind: l.eventName === 'IntentCancelled' ? 'cancelled' : 'expired', user, id, block } as VaultEvent;
      });
      return { events, toBlock };
    },
    async intentStatus(user, id) {
      const s = await pub.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: 'intentOf',
        args: [user, id],
      });
      return s.status;
    },
    async dispatch(user, id) {
      return mined(
        await wallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'dispatch',
          args: [user, id],
        }),
      );
    },
    async dispatchTx(user, id) {
      const logs = await pub.getLogs({
        address: vault,
        event: vaultDispatchedEvent[0],
        args: { user, id },
        fromBlock: o.fromBlock ?? 0n,
      });
      return logs.at(-1)?.transactionHash ?? null;
    },
    async expireIntent(user, id) {
      await mined(
        await wallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'expireIntent',
          args: [user, id],
        }),
      );
    },
    async closeIntent(user, id) {
      await mined(
        await wallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'closeIntent',
          args: [user, id],
        }),
      );
    },
    async settle(message, attestation, intentId) {
      await mined(
        await wallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'settle',
          args: [message, attestation, intentId],
        }),
      );
    },
    async messageUsed(message) {
      return (
        (await pub.readContract({
          address: o.messageTransmitter,
          abi: messageTransmitterAbi,
          functionName: 'usedNonces',
          args: [messageNonce(message)],
        })) > 0n
      );
    },
  };

  const registry: VaultRegistry = {
    vault,
    chainId: o.chainId,
    async registerDepositWallet({ owner, wallet: dw, signature }) {
      await mined(
        await wallet.writeContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'registerDepositWallet',
          args: [getAddress(owner), getAddress(dw), signature],
        }),
      );
    },
  };
  return { chain, registry };
}
