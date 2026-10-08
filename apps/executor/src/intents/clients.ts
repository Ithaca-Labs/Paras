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
import {
  ctfReadAbi,
  ctfTransferEvents,
  erc20BalanceAbi,
  erc20TransferEvent,
  messageTransmitterAbi,
} from '../vault/abi.js';
import { depositWalletAbi, walletFactoryAbi } from '../wallet/abi.js';
import { POLYGON } from '../wallet/constants.js';
import type { WalletChain } from '../wallet/service.js';
import { messageNonce } from './cctp.js';
import type { Geoblock, Iris, PolygonChain, PolygonLogs, WalletTransfer } from './ports.js';

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
    ctfBalance: (w, tokenId) =>
      pub.readContract({
        address: POLYGON.ctf,
        abi: ctfReadAbi,
        functionName: 'balanceOf',
        args: [w, BigInt(tokenId)],
      }),
    async payout(conditionId) {
      const read = <F extends 'payoutDenominator' | 'payoutNumerators'>(
        functionName: F,
        args: F extends 'payoutNumerators' ? readonly [Hex, bigint] : readonly [Hex],
      ) =>
        pub.readContract({
          address: POLYGON.ctf,
          abi: ctfReadAbi,
          functionName,
          args,
        } as never) as Promise<bigint>;
      const denominator = await read('payoutDenominator', [conditionId]);
      if (denominator === 0n) return { denominator, numerators: [] };
      // Binary Markets: outcomes 0 and 1.
      return {
        denominator,
        numerators: await Promise.all([0n, 1n].map((i) => read('payoutNumerators', [conditionId, i]))),
      };
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

/** Polygon transfer logs of pUSD (ERC20) and CTF shares (ERC1155) in or out of the given wallets. */
export function createPolygonLogs(o: { transport: Transport; confirmations?: bigint }): PolygonLogs {
  const pub = createPublicClient({ chain: polygon, transport: o.transport });
  return {
    async head() {
      return (await pub.getBlockNumber()) - (o.confirmations ?? 10n);
    },
    async transfers(fromBlock, toBlock, wallets) {
      const out: WalletTransfer[] = [];
      const mine = new Set(wallets.map((w) => w.toLowerCase()));
      const push = (w: string, asset: string, delta: bigint, l: { blockNumber: bigint; transactionHash: Hex; logIndex: number }) => {
        if (mine.has(w.toLowerCase()))
          out.push({
            wallet: getAddress(w),
            asset,
            delta,
            block: l.blockNumber,
            txHash: l.transactionHash,
            logIndex: l.logIndex,
          });
      };
      // A topic list is an OR; a self-transfer matches both queries and is deduplicated by the unique index.
      for (const side of ['from', 'to'] as const) {
        const args = { [side]: wallets };
        const sign = side === 'to' ? 1n : -1n;
        const [erc20, single, batch] = await Promise.all([
          pub.getLogs({ address: POLYGON.pUSD, event: erc20TransferEvent[0], args, fromBlock, toBlock }),
          pub.getLogs({ address: POLYGON.ctf, event: ctfTransferEvents[0], args, fromBlock, toBlock }),
          pub.getLogs({ address: POLYGON.ctf, event: ctfTransferEvents[1], args, fromBlock, toBlock }),
        ]);
        for (const l of erc20) push(l.args[side]!, 'pusd', sign * l.args.value!, l);
        for (const l of single) push(l.args[side]!, l.args.id!.toString(), sign * l.args.value!, l);
        for (const l of batch)
          l.args.ids!.forEach((id, i) => push(l.args[side]!, id.toString(), sign * l.args.values![i]!, l));
      }
      return out;
    },
  };
}
