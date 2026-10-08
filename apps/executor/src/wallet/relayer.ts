import { createHmac } from 'node:crypto';
import type { Address, Hex } from 'viem';
import type { Batch } from './batch.js';
import { POLYGON } from './constants.js';

/**
 * Port to Polymarket's builder relayer: the only party that can deploy wallets and submit batches
 * (factory `onlyOperator`). Tests inject a fake; the HTTP client below is exercised live only under #35.
 */
export interface RelayerClient {
  /** WALLET-CREATE: deploy the user's Deposit Wallet. */
  deployWallet(p: { owner: Address; salt: Hex }): Promise<{ txId: string }>;
  /** WALLET: submit a signed batch (owner- or session-signed). */
  submitBatch(p: { batch: Batch; signature: Hex; signer: Address }): Promise<{ txId: string }>;
  /** Next batch nonce for the wallet. */
  getNonce(wallet: Address): Promise<bigint>;
  /** Resolves when the tx is confirmed (with its on-chain hash if the relayer reports one); rejects on failure/timeout. */
  waitConfirmed(txId: string): Promise<{ txHash?: Hex }>;
}

export interface BuilderCreds {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface HttpRelayerOptions {
  baseUrl: string;
  creds: BuilderCreds;
  fetch?: typeof fetch;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
}

/** Builder HMAC: base64url(HMAC-SHA256(base64(secret), ts + METHOD + path + body)). */
export function builderHeaders(
  c: BuilderCreds,
  ts: number,
  method: string,
  path: string,
  body = '',
) {
  const sig = createHmac('sha256', Buffer.from(c.secret, 'base64'))
    .update(`${ts}${method}${path}${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return {
    POLY_BUILDER_API_KEY: c.apiKey,
    POLY_BUILDER_TIMESTAMP: String(ts),
    POLY_BUILDER_PASSPHRASE: c.passphrase,
    POLY_BUILDER_SIGNATURE: sig,
  };
}

const jsonBig = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export class HttpRelayerClient implements RelayerClient {
  private readonly f: typeof fetch;
  constructor(private readonly o: HttpRelayerOptions) {
    this.f = o.fetch ?? fetch;
  }

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? '' : jsonBig(body);
    const ts = Math.floor((this.o.now?.() ?? Date.now()) / 1000);
    const res = await this.f(`${this.o.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...builderHeaders(this.o.creds, ts, method, path, payload),
      },
      ...(body !== undefined && { body: payload }),
    });
    if (!res.ok) throw new Error(`relayer ${method} ${path} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async deployWallet(p: { owner: Address; salt: Hex }) {
    const r = await this.req<{ transactionID: string }>('POST', '/submit', {
      type: 'WALLET-CREATE',
      from: p.owner,
      to: POLYGON.walletFactory,
      salt: p.salt,
    });
    return { txId: r.transactionID };
  }

  async submitBatch(p: { batch: Batch; signature: Hex; signer: Address }) {
    const r = await this.req<{ transactionID: string }>('POST', '/submit', {
      type: 'WALLET',
      from: p.signer,
      to: POLYGON.walletFactory,
      nonce: p.batch.nonce,
      signature: p.signature,
      depositWalletParams: {
        depositWallet: p.batch.wallet,
        deadline: p.batch.deadline,
        calls: p.batch.calls,
      },
    });
    return { txId: r.transactionID };
  }

  async getNonce(wallet: Address) {
    const r = await this.req<{ nonce: string | number }>(
      'GET',
      `/v1/account/transactions/params?wallet=${wallet}`,
    );
    return BigInt(r.nonce);
  }

  async waitConfirmed(txId: string) {
    const deadline = Date.now() + (this.o.timeoutMs ?? 120_000);
    for (;;) {
      const r = await this.req<{ state: string; transactionHash?: Hex }>(
        'GET',
        `/transaction?id=${encodeURIComponent(txId)}`,
      );
      if (r.state === 'STATE_CONFIRMED')
        return r.transactionHash ? { txHash: r.transactionHash } : {};
      if (r.state === 'STATE_FAILED' || r.state === 'STATE_INVALID')
        throw new Error(`relayer tx ${txId}: ${r.state}`);
      if (Date.now() > deadline) throw new Error(`relayer tx ${txId}: timeout in ${r.state}`);
      await new Promise((res) => setTimeout(res, this.o.pollMs ?? 2000));
    }
  }
}
