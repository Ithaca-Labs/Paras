export interface CashRow {
  id: string;
  kind: 'deposit' | 'withdrawal';
  amountUsdc: string;
  txHash: string;
  at: Date;
}

/** Vault deposits/withdrawals from the Envio indexer (GraphQL). Injectable so tests use a fake. */
export interface VaultActivitySource {
  cash(p: { users: string[]; before?: Date; limit: number }): Promise<CashRow[]>;
}

const QUERY = `query($users:[String!]!,$before:Int!,$limit:Int!){
  VaultActivity(where:{user:{_in:$users},kind:{_in:["deposit","withdrawal"]},blockTimestamp:{_lt:$before}},
    order_by:{blockTimestamp:desc},limit:$limit){id kind amount txHash blockTimestamp}
}`;

export const createEnvioActivity = (
  url: string,
  fetchFn: typeof fetch = fetch,
): VaultActivitySource => ({
  async cash({ users, before, limit }) {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          users: users.map((u) => u.toLowerCase()),
          // shortcut: second resolution, rows sharing the cursor's second are skipped; fine for cash flows.
          before: before ? Math.floor(before.getTime() / 1000) : 2_147_483_647,
          limit,
        },
      }),
    });
    const j = (await res.json()) as {
      data?: {
        VaultActivity: {
          id: string;
          kind: 'deposit' | 'withdrawal';
          amount: string;
          txHash: string;
          blockTimestamp: number;
        }[];
      };
    };
    if (!res.ok || !j.data) throw new Error(`envio query failed: ${res.status}`);
    return j.data.VaultActivity.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountUsdc: r.amount,
      txHash: r.txHash,
      at: new Date(r.blockTimestamp * 1000),
    }));
  },
});
