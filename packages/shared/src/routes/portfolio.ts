import { defineRoute } from '../route.js';
import { DecimalString } from '../venue.js';
import { z } from '../zod.js';

const Address = z.string().regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x address');
/** USDC / P&L, may be negative. */
const Signed = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal string');
const ReturnTo = z.enum(['vault', 'polygon']);

export const Resolution = z.object({
  /** open -> closed (ended, awaiting oracle) -> proposed (UMA challenge window) | disputed -> resolved. */
  state: z.enum(['open', 'closed', 'proposed', 'disputed', 'resolved']),
  /** Disputed, or still unresolved more than a day after the Market ended. */
  delayed: z.boolean(),
});

const ExitState = z.object({
  id: z.string().uuid(),
  kind: z.enum(['sell', 'redeem']),
  status: z.enum(['requested', 'ordering', 'redeeming', 'returning', 'done', 'failed']),
  reason: z.string().nullable(),
});

export const PortfolioPosition = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  venueId: z.string(),
  question: z.string(),
  outcome: z.string(),
  status: z.enum(['open', 'closed']),
  /** Shares still held (Paras bookkeeping). */
  shares: DecimalString,
  /** Shares the Polygon indexer sees in the Deposit Wallet for this token; null before the indexer has data. */
  onchainShares: DecimalString.nullable(),
  /** USDC paid per share on the original fill. */
  avgCost: DecimalString,
  /** Best bid (what an exit would get), null when the Market has no Quote. */
  price: DecimalString.nullable(),
  /** Cost of the shares still held. */
  costBasis: DecimalString,
  value: DecimalString,
  unrealizedPnl: Signed,
  /** From exits and redemptions so far. */
  realizedPnl: Signed,
  /** Where exit and redemption proceeds go. */
  returnTo: ReturnTo,
  resolution: Resolution,
  /** The live (or last failed) exit or redemption. */
  exit: ExitState.nullable(),
});
export type PortfolioPosition = z.infer<typeof PortfolioPosition>;

export const Portfolio = z.object({
  positions: z.array(PortfolioPosition),
  totals: z.object({
    value: DecimalString,
    costBasis: DecimalString,
    unrealizedPnl: Signed,
    realizedPnl: Signed,
    pnl: Signed,
  }),
  /** pUSD sitting in the Deposit Wallet (indexer), not yet returned to the Vault. */
  collateral: z.object({ wallet: Address.nullable(), pusd: DecimalString }),
});
export type Portfolio = z.infer<typeof Portfolio>;

export const getPortfolio = defineRoute({
  method: 'get',
  path: '/v1/portfolio',
  operationId: 'getPortfolio',
  summary:
    "The User's Vault-placed positions with current value and P&L (unrealized from the best bid, realized from exits/redemptions), resolution/dispute state, and Deposit Wallet collateral from the Polygon indexer",
  tags: ['portfolio'],
  request: {},
  response: Portfolio,
});

// ---------------------------------------------------------------- history

export const HistoryTx = z.object({
  label: z.string(),
  chain: z.enum(['monad', 'polygon']),
  hash: z.string(),
  url: z.string().url(),
});

export const HistoryItem = z.object({
  id: z.string(),
  kind: z.enum(['deposit', 'withdrawal', 'bet', 'exit', 'redemption']),
  at: z.iso.datetime(),
  /** pending: in progress; delayed: no progress for a while; cancelled: expired or cancelled before filling. */
  state: z.enum(['pending', 'delayed', 'complete', 'cancelled', 'failed']),
  /** Raw Intent / exit status. */
  status: z.string().nullable(),
  /** USDC moved or spent. */
  amount: DecimalString.nullable(),
  shares: DecimalString.nullable(),
  question: z.string().nullable(),
  /** Resolution state of the Market behind a bet, exit or redemption. */
  resolution: Resolution.nullable(),
  reason: z.string().nullable(),
  txs: z.array(HistoryTx),
});
export type HistoryItem = z.infer<typeof HistoryItem>;

export const listHistory = defineRoute({
  method: 'get',
  path: '/v1/vault/history',
  operationId: 'listHistory',
  summary:
    'Everything the Vault did for the User, newest first: deposits, withdrawals, bets (Intents), exits and redemptions, each with explorer links for every on-chain transaction, plus delay and dispute states',
  tags: ['portfolio'],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      /** `nextCursor` of the previous page (an ISO time). */
      cursor: z.iso.datetime().optional(),
    }),
  },
  response: z.object({ items: z.array(HistoryItem), nextCursor: z.string().nullable() }),
});

// ---------------------------------------------------------------- exits

export const exitPosition = defineRoute({
  method: 'post',
  path: '/v1/vault/positions/{id}/exit',
  operationId: 'exitPosition',
  summary:
    'Sell a position through the Vault against a user-signed EIP-712 Exit: the Executor sells on the Venue at no less than minPrice and, by default, bridges proceeds back to the Vault. 409 if an exit is already running',
  tags: ['portfolio'],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      /** Worst price per share accepted, 0..1. */
      minPrice: DecimalString,
      /** Shares to sell; omit to sell everything. */
      shares: DecimalString.optional(),
      /** Defaults to the position's setting. */
      returnTo: ReturnTo.optional(),
      /** Unix seconds, at most 10 minutes ahead. */
      deadline: z.number().int().positive(),
      /** EIP-712 `Exit` signature (domain `exitTypedData`) by the position's Vault user address; `shares` signed in base units, all held shares when omitted. */
      signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
    }),
  },
  response: ExitState,
});

export const setPositionReturn = defineRoute({
  method: 'put',
  path: '/v1/vault/positions/{id}/return-to',
  operationId: 'setPositionReturn',
  summary:
    "Choose where this position's exit and redemption proceeds go: back to the Vault (default) or left in the Deposit Wallet on Polygon",
  tags: ['portfolio'],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ returnTo: ReturnTo }),
  },
  response: z.object({ returnTo: ReturnTo }),
});
