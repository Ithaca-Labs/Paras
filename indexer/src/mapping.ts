export type VaultKind =
  | 'deposit'
  | 'withdrawal'
  | 'wallet_registered'
  | 'intent_submitted'
  | 'intent_cancelled'
  | 'intent_expired'
  | 'intent_dispatched'
  | 'settled'
  | 'intent_closed';

interface Fields {
  user: string;
  amount?: bigint;
  intentId?: string;
  wallet?: string;
}

interface Meta {
  transaction: { hash: string };
  logIndex: number;
  block: { number: number; timestamp: number };
}

/** Pure event -> VaultActivity row; handlers only call this and `context.VaultActivity.set`. */
export const toActivity = (kind: VaultKind, f: Fields, e: Meta) => ({
  id: `${e.transaction.hash}-${e.logIndex}`,
  user: f.user.toLowerCase(),
  kind,
  amount: f.amount?.toString(),
  intentId: f.intentId,
  wallet: f.wallet?.toLowerCase(),
  txHash: e.transaction.hash,
  logIndex: e.logIndex,
  blockNumber: e.block.number,
  blockTimestamp: e.block.timestamp,
});
