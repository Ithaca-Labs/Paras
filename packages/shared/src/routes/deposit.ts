import { defineRoute } from '../route.js';
import { z } from '../zod.js';

const tags = ['deposit'];
const Address = z.string().regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x address');

export const AppConfig = z.object({
  features: z.object({
    /** Aurora / NEAR Intents any-chain USDC deposit; mainnet (Monad 143) only. */
    anyChainDeposit: z.boolean(),
  }),
  /** Vault on Monad for client-side deposit/withdraw; null when the chain is not configured. */
  vault: z.object({ address: Address, chainId: z.number().int(), usdc: Address }).nullable(),
  /** Executor simulates the Polymarket leg (testnet demo): the UI shows a banner. */
  demoMode: z.boolean(),
});

export const getConfig = defineRoute({
  method: 'get',
  path: '/v1/config',
  operationId: 'getConfig',
  summary: 'Feature flags for the UI',
  tags: ['system'],
  request: {},
  response: AppConfig,
});

export const DepositToken = z.object({
  /** 1Click asset id, pass as `originAsset`. */
  assetId: z.string(),
  blockchain: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
});

export const listDepositTokens = defineRoute({
  method: 'get',
  path: '/v1/deposit/any-chain/tokens',
  operationId: 'listDepositTokens',
  summary:
    'USDC origin assets (any chain) accepted by the 1Click any-chain deposit. 404 feature_disabled off mainnet',
  tags,
  request: {},
  response: z.object({ items: z.array(DepositToken) }),
});

/** Funds land in the User's Monad wallet first; depositing to the Vault is a second, separate step. */
const NotAtomic = z.object({
  atomic: z.literal(false),
  note: z.string(),
});

export const DepositQuoteRequest = z.object({
  originAsset: z.string().min(1),
  /** Origin amount in base units. */
  amount: z.string().regex(/^[1-9][0-9]*$/),
  /** Address on the origin chain that gets refunds. */
  refundTo: z.string().min(1),
  /** Monad wallet receiving USDC; must be linked to the caller. */
  recipient: Address,
  /** Indicative quote without a deposit address. */
  dry: z.boolean().default(false),
});

export const DepositQuote = NotAtomic.extend({
  recipient: Address,
  /** Absent for `dry` quotes. */
  depositAddress: z.string().optional(),
  depositMemo: z.string().optional(),
  amountIn: z.string(),
  amountOut: z.string(),
  minAmountOut: z.string(),
  /** Deposit before this or funds are refunded. */
  deadline: z.string().optional(),
  timeEstimateSeconds: z.number().optional(),
});

export const quoteDeposit = defineRoute({
  method: 'post',
  path: '/v1/deposit/any-chain/quote',
  operationId: 'quoteDeposit',
  summary:
    "Quote any-chain USDC -> Monad USDC to the caller's own linked wallet via 1Click. Not atomic with the Vault deposit. 403 wallet_not_linked, 404 feature_disabled off mainnet",
  tags,
  request: { body: DepositQuoteRequest },
  response: DepositQuote,
});

export const submitDeposit = defineRoute({
  method: 'post',
  path: '/v1/deposit/any-chain/submit',
  operationId: 'submitDeposit',
  summary: 'Optional hint: tell 1Click the origin-chain deposit tx hash to speed up detection',
  tags,
  request: { body: z.object({ txHash: z.string().min(1), depositAddress: z.string().min(1) }) },
  response: z.object({ status: z.string() }),
});

export const getDepositStatus = defineRoute({
  method: 'get',
  path: '/v1/deposit/any-chain/status',
  operationId: 'getDepositStatus',
  summary:
    'Swap status: PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED, ... After SUCCESS the User deposits to the Vault as a second step',
  tags,
  request: { query: z.object({ depositAddress: z.string().min(1) }) },
  response: NotAtomic.extend({
    status: z.string(),
    updatedAt: z.string(),
    /** Monad tx hashes once funds are delivered. */
    destinationTxHashes: z.array(z.string()),
  }),
});
