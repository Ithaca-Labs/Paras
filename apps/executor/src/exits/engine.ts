import { notify, schema, type Database, type NotifyMailer } from '@paras/db';
import { redeemPayout, TERMINAL_EXIT_STATUSES, toBase6, type ExitStatus } from '@paras/domain';
import { and, eq, sql } from 'drizzle-orm';
import { formatUnits, getAddress, parseUnits, zeroHash, type Address, type Hex } from 'viem';
import type { Clob, Geoblock, Iris, PolygonChain, VaultChain } from '../intents/ports.js';
import { VAULT_STATUS } from '../vault/abi.js';
import { buildSweepCalls, redeemPositions, setCtfApproval } from '../wallet/calls.js';
import { CCTP_DOMAIN, POLYGON } from '../wallet/constants.js';
import type { RelayerClient } from '../wallet/relayer.js';
import type { WalletService } from '../wallet/service.js';

const { exits, intents, markets, positions } = schema;
type ExitRow = typeof exits.$inferSelect;
type PositionRow = typeof positions.$inferSelect;
type Ctx = ExitRow['ctx'];
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ExitStepResult = 'progress' | 'wait' | 'done';

export interface ExitDeps {
  db: Database;
  wallets: Pick<WalletService, 'registeredWalletOf' | 'submitSessionBatch' | 'checkClob'>;
  relayer: Pick<RelayerClient, 'waitConfirmed'>;
  vault: VaultChain;
  polygon: PolygonChain;
  iris: Iris;
  clob: Clob;
  geoblock: Geoblock;
  mailer?: NotifyMailer;
  now?: () => Date;
  /** Swap slippage floor in bps (policy caps it at 100). Default 50. */
  slippageBps?: bigint;
  /** A waiting step older than this fails the exit (ops alert). Default 30 min. */
  waitTimeoutMs?: number;
}

/**
 * Exit / redemption state machine, the sell-side twin of `IntentEngine`:
 *   sell:   requested -> ordering -> (returning) -> done
 *   redeem: requested -> redeeming -> (returning) -> done
 * `returning` (only when the User wants proceeds in the Vault) is pUSD -> USDC.e -> USDC -> CCTP burn to the
 * Vault -> `Vault.settle`. When the position is fully closed the Vault's remaining in-flight claim is written
 * off (`closeIntent`: a loss, or proceeds left on Polygon). Every transition is a compare-and-set on `status`
 * written with its position bookkeeping in one transaction; every effect checks chain/venue state first, so a
 * restart at any point resumes without repeating it.
 */
export class ExitEngine {
  private readonly now: () => Date;
  private readonly slip: bigint;

  constructor(private readonly d: ExitDeps) {
    this.now = d.now ?? (() => new Date());
    this.slip = d.slippageBps ?? 50n;
  }

  async run(id: string, maxSteps = 50): Promise<ExitStepResult> {
    for (let i = 0; i < maxSteps; i++) {
      const r = await this.step(id);
      if (r !== 'progress') return r;
    }
    return 'progress';
  }

  async step(id: string): Promise<ExitStepResult> {
    const [row] = await this.d.db.select().from(exits).where(eq(exits.id, id));
    if (!row) throw new Error(`unknown exit ${id}`);
    if (TERMINAL_EXIT_STATUSES.includes(row.status)) return 'done';
    const [pos] = await this.d.db.select().from(positions).where(eq(positions.id, row.positionId));
    if (!pos) throw new Error(`unknown position ${row.positionId}`);
    switch (row.status) {
      case 'requested':
        return row.kind === 'sell' ? this.begin(row, pos) : this.beginRedeem(row, pos);
      case 'ordering':
        return this.sell(row, pos);
      case 'redeeming':
        return this.redeem(row, pos);
      default:
        return this.returnFunds(row, pos);
    }
  }

  // ---------------------------------------------------------------- sell

  /** Lets the exchange move the wallet's shares (once), then moves on to the order. */
  private async begin(row: ExitRow, pos: PositionRow): Promise<ExitStepResult> {
    if (BigInt(pos.shares) < BigInt(row.shares!) || BigInt(row.shares!) === 0n)
      return this.fail(row, 'position has fewer shares than the exit asks for');
    if (!(await this.d.geoblock.allowed())) return 'wait'; // fail closed
    let approvalTx = row.ctx.approvalTx;
    if (!approvalTx) {
      const wallet = await this.wallet(pos);
      const { txId } = await this.d.wallets.submitSessionBatch({
        walletId: wallet.id,
        intentId: pos.intentRowId,
        calls: [setCtfApproval(pos.negRisk ? POLYGON.negRiskExchange : POLYGON.v2Exchange, true)],
      });
      approvalTx = (await this.d.relayer.waitConfirmed(txId)).txHash ?? txId;
    }
    // Fixed before any order exists, so a restart after the fill (balance already gone) re-sends the same order.
    const addr = getAddress((await this.wallet(pos)).walletAddress);
    const held = await this.d.polygon.ctfBalance(addr, pos.tokenId);
    const want = BigInt(row.shares!);
    const sellable = held < want ? held : want;
    if (sellable === 0n) return this.fail(row, 'wallet holds no shares of this position');
    return this.go(row, 'ordering', {
      approvalTx,
      orderKey: `paras:exit:${row.id}`,
      sellShares: sellable.toString(),
    });
  }

  private async sell(row: ExitRow, pos: PositionRow): Promise<ExitStepResult> {
    const { ctx } = row;
    const wallet = await this.wallet(pos);
    const addr = getAddress(wallet.walletAddress);

    if (!ctx.orderId) {
      if (!(await this.d.geoblock.allowed())) return 'wait';
      const sellable = BigInt(ctx.sellShares!);
      await this.d.wallets.checkClob(wallet.id, { kind: 'order', maker: addr, signer: addr });
      const shares = formatUnits(sellable, 6);
      const { orderId } = await this.d.clob.placeOrder({
        key: ctx.orderKey!,
        wallet: addr,
        tokenId: pos.tokenId,
        side: 'SELL',
        shares,
        price: row.minPrice!,
        amountUsd: formatUnits((sellable * parseUnits(row.minPrice!, 6)) / 1_000_000n, 6),
        type: 'FAK',
      });
      return this.patch(row, { orderId });
    }

    const o = await this.d.clob.getOrder(ctx.orderId);
    if (o.open) return this.waiting(row);
    const sold = toBase6(o.filledShares);
    const proceeds = toBase6(o.spentUsd);
    if (sold === 0n) return this.fail(row, 'nothing filled at the minimum price; position kept');
    const done = { soldShares: sold.toString(), proceedsUsdc: proceeds.toString() };
    // pUSD to hand back; the position loses the sold shares in the same transaction.
    return this.settleProceeds(row, pos, sold, proceeds, done);
  }

  // ---------------------------------------------------------------- redeem

  private async beginRedeem(row: ExitRow, pos: PositionRow): Promise<ExitStepResult> {
    const { denominator, numerators } = await this.d.polygon.payout(pos.conditionId as Hex);
    if (denominator === 0n) return 'wait'; // oracle has not reported yet
    const payout = redeemPayout(
      BigInt(pos.shares),
      numerators[pos.outcomeIndex] ?? 0n,
      denominator,
    );
    return this.go(row, 'redeeming', { payoutUsdc: payout.toString() });
  }

  private async redeem(row: ExitRow, pos: PositionRow): Promise<ExitStepResult> {
    const { ctx } = row;
    const wallet = await this.wallet(pos);
    const addr = getAddress(wallet.walletAddress);
    const payout = BigInt(ctx.payoutUsdc!);

    if (!ctx.redeemRelayerTx) {
      if (!(await this.d.geoblock.allowed())) return 'wait';
      // Redeeming burns every share of the condition the wallet holds; skip when an earlier redeem did it.
      if ((await this.d.polygon.ctfBalance(addr, pos.tokenId)) > 0n) {
        const { txId } = await this.d.wallets.submitSessionBatch({
          walletId: wallet.id,
          intentId: pos.intentRowId,
          calls: [redeemPositions(pos.conditionId as Hex, [1n, 2n])],
        });
        return this.patch(row, { redeemRelayerTx: txId });
      }
    } else if (!ctx.redeemTx) {
      const { txHash } = await this.d.relayer.waitConfirmed(ctx.redeemRelayerTx);
      return this.patch(row, { redeemTx: txHash ?? ctx.redeemRelayerTx });
    }
    if ((await this.d.polygon.ctfBalance(addr, pos.tokenId)) > 0n) return this.waiting(row);
    return this.settleProceeds(row, pos, BigInt(pos.shares), payout, {
      soldShares: pos.shares,
      proceedsUsdc: payout.toString(),
    });
  }

  /** Records the position change with the transition, then returns proceeds to the Vault or finishes. */
  private async settleProceeds(
    row: ExitRow,
    pos: PositionRow,
    sharesGone: bigint,
    proceeds: bigint,
    ctx: Partial<Ctx>,
  ): Promise<ExitStepResult> {
    await this.transition(row, 'returning', { ...ctx, returnPusd: proceeds.toString() }, async (tx) => {
      await tx
        .update(positions)
        .set({
          shares: sql`(${positions.shares}::numeric - ${sharesGone.toString()}::numeric)::text`,
          status: sql`case when ${positions.shares}::numeric - ${sharesGone.toString()}::numeric <= 0 then 'closed' else ${positions.status} end`,
          updatedAt: this.now(),
        })
        .where(eq(positions.id, pos.id));
    });
    return 'progress';
  }

  // ---------------------------------------------------------------- return

  /** pUSD -> USDC.e -> native -> CCTP burn to the Vault, attest, `Vault.settle`. */
  private async returnFunds(row: ExitRow, pos: PositionRow): Promise<ExitStepResult> {
    const { ctx } = row;
    const wallet = await this.wallet(pos);
    const addr = getAddress(wallet.walletAddress);
    const pusd = BigInt(ctx.returnPusd!);
    // Nothing to bridge (loss, or the User keeps proceeds on Polygon): only the Vault claim is left to close.
    if (pusd === 0n || row.returnTo !== 'vault') return this.finishDone(row, pos, pusd);

    if (!ctx.returnRelayerTx) {
      if (!(await this.d.geoblock.allowed())) return 'wait';
      if ((await this.d.polygon.balances(addr)).pusd < pusd)
        return this.fail(row, 'return submitted but not recorded; needs ops');
      const { txId } = await this.d.wallets.submitSessionBatch({
        walletId: wallet.id,
        intentId: pos.intentRowId,
        calls: buildSweepCalls({
          wallet: addr,
          vault: this.d.vault.address,
          pusdAmount: pusd,
          minNative: (pusd * (10_000n - this.slip)) / 10_000n,
        }),
      });
      return this.patch(row, { returnRelayerTx: txId });
    }
    if (!ctx.returnTx) {
      const { txHash } = await this.d.relayer.waitConfirmed(ctx.returnRelayerTx);
      if (!txHash) return this.fail(row, 'relayer gave no tx hash');
      return this.patch(row, { returnTx: txHash });
    }
    if (!ctx.returnMessage) {
      const att = await this.d.iris.attestation(CCTP_DOMAIN.polygon, ctx.returnTx as Hex);
      if (!att) return this.waiting(row);
      return this.patch(row, { returnMessage: att.message, returnAttestation: att.attestation });
    }
    if (!(await this.d.vault.messageUsed(ctx.returnMessage as Hex))) {
      // The buy's claim must still be open to be reduced; otherwise credit without touching a claim.
      const [user, id] = await this.vaultKey(pos);
      const open = (await this.d.vault.intentStatus(user, id)) === VAULT_STATUS.Dispatched;
      const settleTx = await this.d.vault.settle(
        ctx.returnMessage as Hex,
        ctx.returnAttestation as Hex,
        open ? id : zeroHash,
      );
      await this.patch(row, { settleTx });
    }
    return this.finishDone(row, pos, pusd);
  }

  /** Done: write off the Vault claim once nothing of the position is left, then notify. */
  private async finishDone(
    row: ExitRow,
    pos: PositionRow,
    proceeds: bigint,
  ): Promise<ExitStepResult> {
    const [fresh] = await this.d.db.select().from(positions).where(eq(positions.id, pos.id));
    if (fresh?.status === 'closed') {
      const [user, id] = await this.vaultKey(pos);
      if ((await this.d.vault.intentStatus(user, id)) === VAULT_STATUS.Dispatched)
        await this.d.vault.closeIntent(user, id);
    }
    const [r] = await this.d.db.select().from(exits).where(eq(exits.id, row.id));
    if (r && !TERMINAL_EXIT_STATUSES.includes(r.status)) await this.transition(r, 'done', {});
    const what = row.kind === 'sell' ? 'sold' : 'redeemed';
    await notify(this.d.db, this.d.mailer, {
      ownerKey: `u:${row.userId}`,
      kind: 'intent_update',
      dedupeKey: `exit:${row.id}:done`,
      title: `Position ${what}`,
      body:
        proceeds > 0n
          ? `Your position was ${what} for ${formatUnits(proceeds, 6)} USDC${row.returnTo === 'vault' ? '; it is back in your Vault.' : '; it stays in your Polygon wallet.'}`
          : `Your position was ${what}; it paid out nothing.`,
    });
    return 'done';
  }

  // ---------------------------------------------------------------- persistence

  private async vaultKey(pos: PositionRow): Promise<[Address, Hex]> {
    const [i] = await this.d.db
      .select({ intentId: intents.intentId })
      .from(intents)
      .where(eq(intents.id, pos.intentRowId));
    return [getAddress(pos.userAddress), i!.intentId as Hex];
  }

  private async wallet(pos: PositionRow) {
    const w = await this.d.wallets.registeredWalletOf(getAddress(pos.userAddress));
    if (!w) throw new Error('Deposit Wallet missing');
    return w;
  }

  private waiting(row: ExitRow): Promise<ExitStepResult> | ExitStepResult {
    if (this.now().getTime() - row.updatedAt.getTime() <= (this.d.waitTimeoutMs ?? 30 * 60_000))
      return 'wait';
    return this.fail(row, `timeout in ${row.status}`);
  }

  private async fail(row: ExitRow, reason: string): Promise<ExitStepResult> {
    if (await this.transition(row, 'failed', { reason }))
      await notify(this.d.db, this.d.mailer, {
        ownerKey: `u:${row.userId}`,
        kind: 'intent_update',
        dedupeKey: `exit:${row.id}:failed`,
        title: `${row.kind === 'sell' ? 'Exit' : 'Redemption'} failed`,
        body: `Your ${row.kind === 'sell' ? 'exit' : 'redemption'} failed: ${reason}. Check its status.`,
      });
    return 'done';
  }

  private async patch(row: ExitRow, ctx: Partial<Ctx>): Promise<ExitStepResult> {
    await this.d.db
      .update(exits)
      .set({ ctx: sql`${exits.ctx} || ${JSON.stringify(ctx)}::jsonb`, updatedAt: this.now() })
      .where(and(eq(exits.id, row.id), eq(exits.status, row.status)));
    return 'progress';
  }

  private go(row: ExitRow, to: ExitStatus, ctx: Partial<Ctx>): Promise<ExitStepResult> {
    return this.transition(row, to, ctx).then(() => 'progress');
  }

  /** Compare-and-set on the status the step started from; `extra` runs in the same transaction. */
  private async transition(
    row: ExitRow,
    to: ExitStatus,
    ctx: Partial<Ctx>,
    extra?: (tx: Tx) => Promise<void>,
  ): Promise<boolean> {
    return this.d.db.transaction(async (tx) => {
      const moved = await tx
        .update(exits)
        .set({
          status: to,
          ctx: sql`${exits.ctx} || ${JSON.stringify(ctx)}::jsonb`,
          updatedAt: this.now(),
        })
        .where(and(eq(exits.id, row.id), eq(exits.status, row.status)))
        .returning({ id: exits.id });
      if (!moved.length) return false;
      await extra?.(tx);
      return true;
    });
  }
}

/**
 * Redemption scan: opens a `redeem` exit for every open position whose Market has ended and whose condition
 * the CTF reports as resolved. Neg-risk Markets redeem through the NegRiskAdapter, which the policy layer does
 * not allow yet: those positions can be sold but are not auto-redeemed (follow-up).
 */
export async function scanResolved(db: Database, polygon: PolygonChain): Promise<number> {
  const rows = await db
    .select({ p: positions })
    .from(positions)
    .innerJoin(markets, eq(markets.id, positions.marketId))
    .where(and(eq(positions.status, 'open'), sql`${markets.status} <> 'open'`));
  // A failed redemption needs ops: do not reopen it every tick.
  const tried = new Set(
    (await db.select({ id: exits.positionId }).from(exits).where(eq(exits.kind, 'redeem'))).map(
      (e) => e.id,
    ),
  );
  let opened = 0;
  for (const { p } of rows) {
    if (p.negRisk || tried.has(p.id)) continue;
    if ((await polygon.payout(p.conditionId as Hex)).denominator === 0n) continue;
    const ins = await db
      .insert(exits)
      .values({ positionId: p.id, userId: p.userId, kind: 'redeem', returnTo: p.returnTo })
      .onConflictDoNothing()
      .returning({ id: exits.id });
    opened += ins.length;
  }
  return opened;
}
