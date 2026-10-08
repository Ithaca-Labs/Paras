import { createHmac } from 'node:crypto';
import {
  getAddress,
  hashTypedData,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { POLYGON, POLYGON_CHAIN_ID } from '../wallet/constants.js';
import type { Clob, ClobOrderRequest } from '../intents/ports.js';
import {
  buyAmounts,
  fromUnits,
  sellAmounts,
  ORDER_FIELDS,
  signPoly1271Order,
  toUnits,
  EXCHANGE_DOMAIN_NAME,
  ZERO32,
  type V2Order,
} from './order.js';

export interface ApiCreds {
  key: string;
  secret: string;
  passphrase: string;
}

export interface HttpClobOptions {
  baseUrl: string;
  /** Paras builder code (bytes32), put in every order's `builder` field for attribution. */
  builderCode: Hex;
  /** Session key of the Deposit Wallet (decrypted on demand). Callers run `WalletService.checkClob` first. */
  sessionKey: (wallet: Address) => Promise<LocalAccount>;
  fetch?: typeof fetch;
  now?: () => number;
}

const MSG = 'This message attests that I control the given wallet';

/** `<wallet>:<orderHash>`: getOrder/cancel only get the id back, and the wallet picks the session key and API creds. */
const encodeId = (wallet: Address, hash: string) => `${wallet}:${hash}`;
const decodeId = (id: string): { wallet: Address; hash: string } => {
  const [wallet, hash] = id.split(':');
  if (!wallet || !hash) throw new Error(`bad order id ${id}`);
  return { wallet: getAddress(wallet), hash };
};

/** HMAC-SHA256 over `ts + METHOD + path + body`, key = base64 secret, output url-safe base64 (padded). */
export function l2Signature(secret: string, ts: number, method: string, path: string, body = '') {
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${ts}${method}${path}${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Polymarket CLOB v2 for Deposit Wallets. Orders are POLY_1271 (maker = signer = the wallet) signed by the session
 * key; L1/L2 auth uses the session key too (the API key is bound to the signer EOA, PRD risk finding 2a; whether
 * the CLOB accepts this is validated live in #35).
 */
export class HttpClob implements Clob {
  private readonly f: typeof fetch;
  private readonly creds = new Map<Address, Promise<ApiCreds>>();
  private readonly stamps = new Map<string, bigint>();

  constructor(private readonly o: HttpClobOptions) {
    this.f = o.fetch ?? fetch;
  }

  private now = () => this.o.now?.() ?? Date.now();

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const qs = init.query ? `?${new URLSearchParams(init.query)}` : '';
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const res = await this.f(`${this.o.baseUrl}${path}${qs}`, {
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      ...(body !== undefined && { body }),
    });
    if (!res.ok) throw new Error(`clob ${method} ${path} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** L1: sign `ClobAuth` with the session key, create the API key (or derive it if it exists). */
  private async derive(acct: LocalAccount): Promise<ApiCreds> {
    const ts = Math.floor(this.now() / 1000);
    const signature = await acct.signTypedData({
      domain: { name: 'ClobAuthDomain', version: '1', chainId: POLYGON_CHAIN_ID },
      types: {
        ClobAuth: [
          { name: 'address', type: 'address' },
          { name: 'timestamp', type: 'string' },
          { name: 'nonce', type: 'uint256' },
          { name: 'message', type: 'string' },
        ],
      },
      primaryType: 'ClobAuth',
      message: { address: acct.address, timestamp: String(ts), nonce: 0n, message: MSG },
    });
    const headers = {
      POLY_ADDRESS: acct.address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: String(ts),
      POLY_NONCE: '0',
    };
    type Raw = { apiKey?: string; secret: string; passphrase: string };
    let raw = await this.call<Raw>('POST', '/auth/api-key', { headers }).catch(() => undefined);
    if (!raw?.apiKey) raw = await this.call<Raw>('GET', '/auth/derive-api-key', { headers });
    return { key: raw.apiKey!, secret: raw.secret, passphrase: raw.passphrase };
  }

  private async session(wallet: Address) {
    const acct = await this.o.sessionKey(wallet);
    let c = this.creds.get(acct.address);
    if (!c) {
      c = this.derive(acct);
      this.creds.set(acct.address, c);
      c.catch(() => this.creds.delete(acct.address)); // retry next call
    }
    return { acct, creds: await c };
  }

  /** L2-authenticated call. `body` is signed as the exact JSON string sent. */
  private async l2<T>(
    wallet: Address,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ) {
    const { acct, creds } = await this.session(wallet);
    const ts = Math.floor(this.now() / 1000);
    const body = init.body === undefined ? '' : JSON.stringify(init.body);
    return this.call<T>(method, path, {
      ...init,
      headers: {
        POLY_ADDRESS: acct.address,
        POLY_SIGNATURE: l2Signature(creds.secret, ts, method, path, body),
        POLY_TIMESTAMP: String(ts),
        POLY_API_KEY: creds.key,
        POLY_PASSPHRASE: creds.passphrase,
      },
    });
  }

  /** Exchange the order is signed for: `/version` 3 -> V3 exchange (no neg-risk); 2 -> CTF or neg-risk V2. */
  private async exchange(tokenId: string) {
    const v = (await this.call<{ version?: number }>('GET', '/version').catch(() => ({}))) as {
      version?: number;
    };
    if (v.version === 3) return { verifyingContract: POLYGON.v2Exchange, version: '3' };
    const { neg_risk } = await this.call<{ neg_risk: boolean }>('GET', '/neg-risk', {
      query: { token_id: tokenId },
    });
    return {
      verifyingContract: neg_risk ? POLYGON.negRiskExchange : POLYGON.ctfExchange,
      version: '2',
    };
  }

  async placeOrder(r: ClobOrderRequest): Promise<{ orderId: string }> {
    const wallet = getAddress(r.wallet);
    const { acct } = await this.session(wallet);
    const sell = r.side === 'SELL';
    const existing = r.type === 'GTC' ? await this.findRestingOrder(wallet, r) : undefined;
    if (existing) return { orderId: encodeId(wallet, existing) };

    const { minimum_tick_size } = await this.call<{ minimum_tick_size: number | string }>(
      'GET',
      '/tick-size',
      { query: { token_id: r.tokenId } },
    );
    const tick = String(minimum_tick_size);
    const amounts = sell
      ? sellAmounts(r.shares!, r.price, tick)
      : buyAmounts(r.amountUsd, r.price, tick);
    // Same key -> same salt and timestamp -> same order hash, so a retry cannot double-post: the caller persists
    // `r.timestamp` before the first attempt, which makes this hold across restarts too.
    const salt = BigInt(keccak256(toHex(r.key)).slice(0, 14)); // 48 bits: survives JSON numbers
    const timestamp =
      r.timestamp !== undefined
        ? BigInt(r.timestamp)
        : (this.stamps.get(r.key) ?? BigInt(this.now()));
    this.stamps.set(r.key, timestamp);
    const order: V2Order = {
      salt,
      maker: wallet,
      signer: wallet,
      tokenId: BigInt(r.tokenId),
      makerAmount: amounts.makerAmount,
      takerAmount: amounts.takerAmount,
      side: sell ? 1 : 0,
      signatureType: 3,
      timestamp,
      metadata: ZERO32,
      builder: this.o.builderCode,
    };
    const domain = await this.exchange(r.tokenId);
    const signature = await signPoly1271Order(acct, order, {
      chainId: POLYGON_CHAIN_ID,
      ...domain,
    });
    const { creds } = await this.session(wallet);
    const hash = hashTypedData({
      domain: {
        name: EXCHANGE_DOMAIN_NAME,
        version: domain.version,
        chainId: POLYGON_CHAIN_ID,
        verifyingContract: domain.verifyingContract,
      },
      types: { Order: ORDER_FIELDS },
      primaryType: 'Order',
      message: order,
    });
    const res = await this.l2<{ success: boolean; errorMsg?: string; orderID?: string }>(
      wallet,
      'POST',
      '/order',
      {
        body: {
          deferExec: false,
          postOnly: false,
          order: {
            salt: Number(salt),
            maker: order.maker,
            signer: order.signer,
            tokenId: r.tokenId,
            makerAmount: order.makerAmount.toString(),
            takerAmount: order.takerAmount.toString(),
            side: sell ? 'SELL' : 'BUY',
            signatureType: 3,
            timestamp: order.timestamp.toString(),
            expiration: '0',
            metadata: order.metadata,
            builder: order.builder,
            signature,
          },
          owner: creds.key,
          orderType: r.type,
        },
      },
    );
    if (!res.success || !res.orderID) {
      // The identical order (same hash) already exists: a retry after a crash. Recover its id, never re-spend.
      if (/duplicate|already/i.test(res.errorMsg ?? '')) return { orderId: encodeId(wallet, hash) };
      throw new Error(`clob order rejected: ${res.errorMsg}`);
    }
    return { orderId: encodeId(wallet, res.orderID) };
  }

  /** Restart recovery for resting orders: the timestamp is lost, so match on the live order instead. */
  private async findRestingOrder(wallet: Address, r: ClobOrderRequest) {
    const res = await this.l2<OpenOrder[] | { data: OpenOrder[] }>(wallet, 'GET', '/data/orders', {
      query: { asset_id: r.tokenId },
    });
    const orders = Array.isArray(res) ? res : res.data;
    const hit = orders.find(
      (o) =>
        o.side === (r.side ?? 'BUY') &&
        o.status.toUpperCase() === 'LIVE' &&
        getAddress(o.maker_address) === wallet &&
        toUnits(o.price) <= toUnits(r.price), // shortcut: any live BUY under our cap counts, fine for one open Intent per token
    );
    return hit?.id;
  }

  async getOrder(orderId: string) {
    const { wallet, hash } = decodeId(orderId);
    const o = await this.l2<OpenOrder>(wallet, 'GET', `/data/order/${hash}`);
    const open = ['LIVE', 'DELAYED'].includes(o.status.toUpperCase());
    // Spent = what the trades actually cost (price improvement means size_matched * limit would overstate).
    let spent = 0n;
    for (const id of o.associate_trades ?? []) {
      const t = await this.l2<{ data: Trade[] }>(wallet, 'GET', '/data/trades', { query: { id } });
      for (const x of t.data)
        if (x.status.toUpperCase() !== 'FAILED')
          spent += (toUnits(x.size) * toUnits(x.price)) / 1_000_000n;
    }
    const matched = toUnits(o.size_matched);
    if (matched > 0n && spent === 0n) spent = (matched * toUnits(o.price)) / 1_000_000n; // trades not indexed yet
    return { open, filledShares: fromUnits(matched) || '0', spentUsd: fromUnits(spent) || '0' };
  }

  async cancel(orderId: string): Promise<void> {
    const { wallet, hash } = decodeId(orderId);
    await this.l2(wallet, 'DELETE', '/order', { body: { orderID: hash } });
  }
}

interface OpenOrder {
  id: string;
  status: string;
  maker_address: string;
  side: string;
  price: string;
  size_matched: string;
  associate_trades?: string[];
}
interface Trade {
  status: string;
  size: string;
  price: string;
}
