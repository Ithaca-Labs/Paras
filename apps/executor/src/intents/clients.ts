import {
  createPublicClient,
  createWalletClient,
  getAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type Transport,
} from 'viem';
import { polygon } from 'viem/chains';
import { erc20BalanceAbi, messageTransmitterAbi } from '../vault/abi.js';
import { depositWalletAbi, walletFactoryAbi } from '../wallet/abi.js';
import { POLYGON } from '../wallet/constants.js';
import type { WalletChain } from '../wallet/service.js';
import { messageNonce } from './cctp.js';
import type { Geoblock, Iris, PolygonChain } from './ports.js';

/** Polygon reads and the permissionless CCTP mint (Executor pays gas). Also serves `WalletService`'s chain reads. */
export function createPolygon(o: {
  transport: Transport;
  account: LocalAccount;
}): PolygonChain & WalletChain {
  const pub = createPublicClient({ chain: polygon, transport: o.transport });
  const wallet = createWalletClient({ chain: polygon, transport: o.transport, account: o.account });
  const bal = (token: Address, who: Address) =>
    pub.readContract({
      address: token,
      abi: erc20BalanceAbi,
      functionName: 'balanceOf',
      args: [who],
    });
  return {
    async balances(w) {
      const [native, usdce, pusd] = await Promise.all([
        bal(POLYGON.usdcNative, w),
        bal(POLYGON.usdcE, w),
        bal(POLYGON.pUSD, w),
      ]);
      return { native, usdce, pusd };
    },
    async messageUsed(message) {
      const used = await pub.readContract({
        address: POLYGON.messageTransmitterV2,
        abi: messageTransmitterAbi,
        functionName: 'usedNonces',
        args: [messageNonce(message)],
      });
      return used > 0n;
    },
    async receiveMessage(message, attestation) {
      const hash = await wallet.writeContract({
        address: POLYGON.messageTransmitterV2,
        abi: messageTransmitterAbi,
        functionName: 'receiveMessage',
        args: [message, attestation],
      });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error(`mint ${hash} reverted`);
    },
    predictWalletAddress: (id: Hex) =>
      pub.readContract({
        address: POLYGON.walletFactory,
        abi: walletFactoryAbi,
        functionName: 'predictWalletAddress',
        args: [id],
      }),
    async walletOwner(w) {
      if (!(await pub.getCode({ address: w }))) return null;
      return getAddress(
        await pub.readContract({ address: w, abi: depositWalletAbi, functionName: 'owner' }),
      );
    },
  };
}

/** Circle Iris v2: `GET /v2/messages/{domain}?transactionHash=`; pending until the attestation is `complete`. */
export function createIris(o: { baseUrl?: string; fetch?: typeof fetch } = {}): Iris {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl ?? 'https://iris-api.circle.com';
  return {
    async attestation(domain, txHash) {
      const res = await f(`${base}/v2/messages/${domain}?transactionHash=${txHash}`);
      if (res.status === 404) return null; // not indexed yet
      if (!res.ok) throw new Error(`iris ${res.status}`);
      const body = (await res.json()) as {
        messages?: { status: string; message: Hex; attestation: Hex }[];
      };
      const m = body.messages?.find((x) => x.status === 'complete');
      return m ? { message: m.message, attestation: m.attestation } : null;
    },
  };
}

/** Polymarket geoblock for this host's IP. Any error or `blocked: true` means not allowed. */
export function createGeoblock(o: { url?: string; fetch?: typeof fetch } = {}): Geoblock {
  const f = o.fetch ?? fetch;
  return {
    async allowed() {
      try {
        const res = await f(o.url ?? 'https://polymarket.com/api/geoblock');
        return res.ok && ((await res.json()) as { blocked: boolean }).blocked === false;
      } catch {
        return false;
      }
    },
  };
}
