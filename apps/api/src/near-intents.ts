export const ONE_CLICK_URL = 'https://1click.chaindefuser.com/v0';
/** Monad USDC (chain 143) in 1Click asset ids. */
export const MONAD_USDC_ASSET = 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx';

export interface OneClickToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
}

export interface OneClickQuote {
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    deadline?: string;
    timeEstimate?: number;
  };
}

export interface OneClickStatus {
  status: string;
  updatedAt: string;
  swapDetails?: { destinationChainTxHashes?: { hash: string }[] };
}

export interface QuoteParams {
  dry: boolean;
  originAsset: string;
  amount: string;
  refundTo: string;
  /** Monad wallet that receives the USDC. */
  recipient: string;
  deadline: string;
}

/** 1Click (NEAR Intents) client: tokens, quote, deposit/submit, status. */
export interface NearIntents {
  tokens(): Promise<OneClickToken[]>;
  quote(p: QuoteParams): Promise<OneClickQuote>;
  submit(p: { txHash: string; depositAddress: string }): Promise<{ status: string }>;
  status(depositAddress: string): Promise<OneClickStatus | null>;
}

export function createNearIntents(
  o: { apiKey?: string | undefined; fetch?: typeof fetch } = {},
): NearIntents {
  const doFetch = o.fetch ?? fetch;
  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(`${ONE_CLICK_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(o.apiKey && { 'x-api-key': o.apiKey }),
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`1Click ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }
  const post = (path: string, body: unknown) =>
    call(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    tokens: async () => ((await call('/tokens')) ?? []) as OneClickToken[],
    quote: async (p) =>
      (await post('/quote', {
        dry: p.dry,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: p.originAsset,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset: MONAD_USDC_ASSET,
        amount: p.amount,
        refundTo: p.refundTo,
        refundType: 'ORIGIN_CHAIN',
        recipient: p.recipient,
        recipientType: 'DESTINATION_CHAIN',
        deadline: p.deadline,
      })) as OneClickQuote,
    submit: async (p) => (await post('/deposit/submit', p)) as { status: string },
    status: async (depositAddress) =>
      (await call(
        `/status?depositAddress=${encodeURIComponent(depositAddress)}`,
      )) as OneClickStatus | null,
  };
}
