import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { HttpClob, l2Signature } from '../../src/clob/client.js';
import { buyAmounts, sellAmounts, signPoly1271Order, type V2Order } from '../../src/clob/order.js';
import { POLYGON } from '../../src/wallet/constants.js';

const session = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '71321045679252212594626385532706912750332728571942532289631379312455583992563';
const BUILDER: Hex = `0x${'ab'.repeat(32)}`;
const ZERO = `0x${'0'.repeat(64)}` as Hex;

const order: V2Order = {
  salt: 12345678901n,
  maker: WALLET,
  signer: WALLET,
  tokenId: BigInt(TOKEN),
  makerAmount: 5_000_000n,
  takerAmount: 10_000_000n,
  side: 0,
  signatureType: 3,
  timestamp: 1760000000000n,
  metadata: ZERO,
  builder: BUILDER,
};

// Produced by the official @polymarket/clob-client-v2 1.2.0 (ExchangeOrderBuilderV2/V3) with the same key and order.
const SUFFIX =
  '1f4f726465722875696e743235362073616c742c61646472657373206d616b65722c61646472657373207369676e65722c75696e7432353620746f6b656e49642c75696e74323536206d616b6572416d6f756e742c75696e743235362074616b6572416d6f756e742c75696e743820736964652c75696e7438207369676e6174757265547970652c75696e743235362074696d657374616d702c62797465733332206d657461646174612c62797465733332206275696c6465722900ba';
const GOLDEN_V2 =
  '0x022b3d65def757c7bb046c277ea179ce7069b6e06d8ed44dda52e9111a5a4770653c5d84060a86ec953faf288060a82f45b839a4dab138f49aa0b2a48ffbeacb1c3264e159346253e26a64e00b69032db0e7d32f94628de3e6eecb50304d7af3d217c796140e8cd50603543c8f938f4c77ea5d454b104c9bc004637f67c6c65d1f4f726465722875696e743235362073616c742c61646472657373206d616b65722c61646472657373207369676e65722c75696e7432353620746f6b656e49642c75696e74323536206d616b6572416d6f756e742c75696e743235362074616b6572416d6f756e742c75696e743820736964652c75696e7438207369676e6174757265547970652c75696e743235362074696d657374616d702c62797465733332206d657461646174612c62797465733332206275696c6465722900ba';
const GOLDEN_V3_PREFIX =
  '0x007525f749e81abc6b8b810d94291d9ad3aa54408ea7de250ce65397430e1cdd4771f784a037b9200f15fef2d489268ad3d4f50e634567b0b2a0afd3caa32e491c';

describe('POLY_1271 order signature', () => {
  it('matches the official client byte for byte (V2 and V3 exchange)', async () => {
    const v2 = await signPoly1271Order(session, order, {
      chainId: 137,
      verifyingContract: POLYGON.ctfExchange,
      version: '2',
    });
    expect(v2).toBe(GOLDEN_V2);
    const v3 = await signPoly1271Order(session, order, {
      chainId: 137,
      verifyingContract: POLYGON.v2Exchange,
      version: '3',
    });
    expect(v3.startsWith(GOLDEN_V3_PREFIX)).toBe(true);
    expect(v3.endsWith(SUFFIX.slice(4))).toBe(true);
  });

  it('inner signature recovers to the session key over the wallet-nested digest', async () => {
    const sig = await signPoly1271Order(session, order, {
      chainId: 137,
      verifyingContract: POLYGON.ctfExchange,
      version: '2',
    });
    const addr = await recoverTypedDataAddress({
      domain: {
        name: 'Polymarket CTF Exchange',
        version: '2',
        chainId: 137,
        verifyingContract: POLYGON.ctfExchange,
      },
      types: {
        TypedDataSign: [
          { name: 'contents', type: 'Order' },
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
          { name: 'salt', type: 'bytes32' },
        ],
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'metadata', type: 'bytes32' },
          { name: 'builder', type: 'bytes32' },
        ],
      },
      primaryType: 'TypedDataSign',
      message: {
        contents: order,
        name: 'DepositWallet',
        version: '1',
        chainId: 137n,
        verifyingContract: WALLET,
        salt: ZERO,
      },
      signature: sig.slice(0, 132) as Hex,
    });
    expect(addr).toBe(session.address);
  });
});

describe('buyAmounts', () => {
  it('rounds price down to tick and shares down to cents; never exceeds the budget', () => {
    const a = buyAmounts('5', '0.5', '0.01');
    expect(a).toEqual({ makerAmount: 5_000_000n, takerAmount: 10_000_000n, price: '0.5' });
    const b = buyAmounts('10', '0.557', '0.01'); // price -> 0.55
    expect(b.price).toBe('0.55');
    expect(b.makerAmount <= 10_000_000n).toBe(true);
    expect(b.takerAmount).toBe(18_180_000n); // 18.18 shares
    expect(b.makerAmount).toBe(9_999_000n);
  });
  it('rejects out-of-range prices and dust', () => {
    expect(() => buyAmounts('5', '1', '0.01')).toThrow();
    expect(() => buyAmounts('0.001', '0.9', '0.01')).toThrow();
  });
});

describe('HttpClob over recorded HTTP', () => {
  const NOW = 1_760_000_000_000;
  const secret = Buffer.from('shh-secret').toString('base64');
  const creds = { apiKey: 'k-1', secret, passphrase: 'pp' };

  function world(
    o: {
      version?: number;
      negRisk?: boolean;
      existing?: unknown[];
      reject?: boolean;
      rejectMsg?: string;
    } = {},
  ) {
    const calls: { method: string; path: string; headers: Headers; body?: string }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const call = {
        method: init.method ?? 'GET',
        path: u.pathname,
        headers: new Headers(init.headers),
        body: init.body as string | undefined,
      };
      calls.push(call);
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      const k = `${call.method} ${u.pathname}`;
      if (k === 'POST /auth/api-key') return json(creds);
      if (k === 'GET /version') return json({ version: o.version ?? 2 });
      if (k === 'GET /tick-size') return json({ minimum_tick_size: 0.01 });
      if (k === 'GET /neg-risk') return json({ neg_risk: o.negRisk ?? false });
      if (k === 'GET /data/orders') return json({ data: o.existing ?? [] });
      if (k === 'POST /order' && o.reject)
        return json({ success: false, errorMsg: o.rejectMsg ?? 'not enough balance' });
      if (k === 'POST /order') return json({ success: true, orderID: '0xhash', status: 'live' });
      if (k === 'DELETE /order') return json({ canceled: ['0xhash'] });
      if (k === 'GET /data/order/0xhash')
        return json({
          id: '0xhash',
          status: 'MATCHED',
          maker_address: WALLET,
          side: 'BUY',
          price: '0.55',
          original_size: '10',
          size_matched: '10',
          associate_trades: ['t1'],
        });
      if (k === 'GET /data/trades')
        return json({ data: [{ status: 'CONFIRMED', size: '10', price: '0.5' }] });
      return json({ error: 'nope' }, 404);
    }) as typeof fetch;
    const clob = new HttpClob({
      baseUrl: 'https://clob.test',
      builderCode: BUILDER,
      sessionKey: async () => session,
      fetch: f,
      now: () => NOW,
    });
    return { clob, calls };
  }

  const req = {
    key: 'paras:intent-1',
    wallet: WALLET,
    tokenId: TOKEN,
    price: '0.5',
    amountUsd: '5',
    type: 'FAK' as const,
  };

  it('L1-auths with the session key, posts a POLY_1271 order with builder code and L2 headers', async () => {
    const { clob, calls } = world();
    const { orderId } = await clob.placeOrder(req);
    expect(orderId).toBe(`${WALLET}:0xhash`);

    const auth = calls.find((c) => c.path === '/auth/api-key')!;
    expect(auth.headers.get('POLY_ADDRESS')).toBe(session.address);
    expect(auth.headers.get('POLY_TIMESTAMP')).toBe(String(NOW / 1000));
    const authSig = auth.headers.get('POLY_SIGNATURE') as Hex;
    const signer = await recoverTypedDataAddress({
      domain: { name: 'ClobAuthDomain', version: '1', chainId: 137 },
      types: {
        ClobAuth: [
          { name: 'address', type: 'address' },
          { name: 'timestamp', type: 'string' },
          { name: 'nonce', type: 'uint256' },
          { name: 'message', type: 'string' },
        ],
      },
      primaryType: 'ClobAuth',
      message: {
        address: session.address,
        timestamp: String(NOW / 1000),
        nonce: 0n,
        message: 'This message attests that I control the given wallet',
      },
      signature: authSig,
    });
    expect(signer).toBe(session.address);

    const post = calls.find((c) => c.path === '/order')!;
    expect(post.headers.get('POLY_API_KEY')).toBe('k-1');
    expect(post.headers.get('POLY_SIGNATURE')).toBe(
      l2Signature(secret, NOW / 1000, 'POST', '/order', post.body),
    );
    const body = JSON.parse(post.body!);
    expect(body.owner).toBe('k-1');
    expect(body.orderType).toBe('FAK');
    expect(body.order).toMatchObject({
      maker: WALLET,
      signer: WALLET,
      signatureType: 3,
      side: 'BUY',
      builder: BUILDER,
      makerAmount: '5000000',
      takerAmount: '10000000',
      timestamp: String(NOW),
    });
    expect(body.order.signature).toMatch(/^0x[0-9a-f]+00ba$/);
  });

  it('is idempotent per key in-process and reuses API creds', async () => {
    const { clob, calls } = world();
    await clob.placeOrder(req);
    await clob.placeOrder(req);
    const posts = calls.filter((c) => c.path === '/order');
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0]!.body!).order.signature).toBe(
      JSON.parse(posts[1]!.body!).order.signature,
    );
    expect(calls.filter((c) => c.path === '/auth/api-key')).toHaveLength(1);
  });

  it('signs for the neg-risk and V3 exchanges when the CLOB says so', async () => {
    const sig = async (w: ReturnType<typeof world>) => {
      await w.clob.placeOrder(req);
      return JSON.parse(w.calls.find((c) => c.path === '/order')!.body!).order.signature as string;
    };
    const base = await sig(world());
    expect(await sig(world({ negRisk: true }))).not.toBe(base);
    expect(await sig(world({ version: 3 }))).not.toBe(base);
  });

  it('GTC: returns an already-resting order instead of posting a second one', async () => {
    const { clob, calls } = world({
      existing: [
        { id: '0xlive', status: 'LIVE', maker_address: WALLET, side: 'BUY', price: '0.5' },
      ],
    });
    const { orderId } = await clob.placeOrder({ ...req, type: 'GTC' });
    expect(orderId).toBe(`${WALLET}:0xlive`);
    expect(calls.some((c) => c.path === '/order')).toBe(false);
  });

  it('getOrder sums real trade cost (price improvement) and cancel hits DELETE /order', async () => {
    const { clob, calls } = world();
    const id = `${WALLET}:0xhash`;
    expect(await clob.getOrder(id)).toEqual({ open: false, filledShares: '10', spentUsd: '5' });
    await clob.cancel(id);
    expect(JSON.parse(calls.find((c) => c.method === 'DELETE')!.body!)).toEqual({
      orderID: '0xhash',
    });
  });

  it('surfaces CLOB rejections', async () => {
    const { clob } = world({ reject: true });
    await expect(clob.placeOrder(req)).rejects.toThrow(/not enough balance/);
  });

  it('SELL: maker gives shares, taker gives USDC, side SELL, price rounded up to the tick', async () => {
    const { clob, calls } = world();
    await clob.placeOrder({
      key: 'paras:exit:1',
      wallet: WALLET,
      tokenId: TOKEN,
      side: 'SELL',
      shares: '18.090909',
      price: '0.604',
      amountUsd: '10.9',
      type: 'FAK',
    });
    const body = JSON.parse(calls.find((c) => c.path === '/order')!.body!);
    expect(body.order).toMatchObject({
      side: 'SELL',
      makerAmount: '18090000', // 18.09 shares, rounded down to cents
      takerAmount: '11034900', // at 0.61 (0.604 rounded up to the tick)
    });
  });

  it('the persisted timestamp fixes the order hash across restarts (no second order)', async () => {
    const a = world();
    const b = world();
    await a.clob.placeOrder({ ...req, timestamp: NOW });
    await b.clob.placeOrder({ ...req, timestamp: NOW });
    const post = (w: ReturnType<typeof world>) =>
      JSON.parse(w.calls.find((c) => c.path === '/order')!.body!).order;
    expect(post(a)).toEqual(post(b)); // identical salt, timestamp and signature
  });

  it('a duplicate-order rejection on retry returns the order id instead of failing or re-spending', async () => {
    const { clob } = world({ reject: true, rejectMsg: 'order already exists' });
    const { orderId } = await clob.placeOrder({ ...req, timestamp: NOW });
    expect(orderId).toMatch(new RegExp(`^${WALLET}:0x[0-9a-f]{64}$`));
  });
});

describe('sellAmounts', () => {
  it('rounds shares down to cents and the price up to the tick', () => {
    expect(sellAmounts('10', '0.5', '0.01')).toEqual({
      makerAmount: 10_000_000n,
      takerAmount: 5_000_000n,
      price: '0.5',
    });
    expect(sellAmounts('1.239', '0.501', '0.01').price).toBe('0.51');
    expect(() => sellAmounts('0.001', '0.5', '0.01')).toThrow();
  });
});
