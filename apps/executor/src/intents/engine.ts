import { isDispatchPaused, notify, schema, type Database, type NotifyMailer } from '@paras/db';
import { fillWithinMaxPrice, TERMINAL_INTENT_STATUSES, type IntentStatus } from '@paras/domain';
import { and, eq, sql } from 'drizzle-orm';
import { formatUnits, getAddress, parseUnits, type Address, type Hex } from 'viem';
import { buildConvertCalls, buildSweepCalls } from '../wallet/calls.js';
import { CCTP_DOMAIN, POLYGON } from '../wallet/constants.js';
import type { RelayerClient } from '../wallet/relayer.js';
import type { WalletService } from '../wallet/service.js';
import { VAULT_STATUS } from '../vault/abi.js';
import { mintedAmount } from './cctp.js';
import type {
  BookSource,
  Clob,
  Geoblock,
  Iris,
  PolygonChain,
  VaultChain,
  VaultEvent,
} from './ports.js';

const { intents, intentEvents } = schema;
type IntentRow = typeof intents.$inferSelect;
type Ctx = IntentRow['ctx'];

/** `progress`: state changed, step again now. `wait`: nothing to do until the outside world moves. `done`: terminal. */
export type StepResult = 'progress' | 'wait' | 'done';

export interface EngineDeps {
  db: Database;
  wallets: Pick<
    WalletService,
    'registeredWalletOf' | 'openIntent' | 'submitSessionBatch' | 'checkClob'
  >;
  relayer: Pick<RelayerClient, 'waitConfirmed'>;
  vault: VaultChain;
  polygon: PolygonChain;
  iris: Iris;
  clob: Clob;
  books: BookSource;
  geoblock: Geoblock;
  /** Sends the email leg of notifications (in-app rows are always stored). */
  mailer?: NotifyMailer;
  now?: () => Date;
  /** Swap slippage floor in bps (policy caps it at 100). Default 50. */
  slippageBps?: bigint;
  /** A waiting step older than this fails the Intent (ops alert). Default 30 min. */
  waitTimeoutMs?: number;
}

/** Below this (USDC base units, $0.01) a leftover is dust: not worth a return trip. */
const DUST = 10_000n;
const NOTIFY: IntentStatus[] = ['filled', 'partially_filled', 'failed', 'expired'];

/**
 * Intent state machine: previewed -> signed -> dispatched -> bridging -> bridged -> ordering -> filled
 * | (returning -> partially_filled | expired | failed). Every transition is a compare-and-set on `status`
 * written with its timeline row in one transaction; every external effect first checks chain/venue state
 * (or an idempotency key), so a crash at any point resumes without repeating it.
 */
export class IntentEngine {
  private readonly now: () => Date;
  private readonly slip: bigint;

  constructor(private readonly d: EngineDeps) {
    this.now = d.now ?? (() => new Date());
    this.slip = d.slippageBps ?? 50n;
  }

  /** Steps until the Intent has to wait or finishes. */
  async run(id: string, maxSteps = 50): Promise<StepResult> {
    for (let i = 0; i < maxSteps; i++) {
      const r = await this.step(id);
      if (r !== 'progress') return r;
    }
    return 'progress';
  }

  /** Applies a Vault event: `submitted` arms a previewed Intent; cancel/expiry before dispatch end it. */
  async onVaultEvent(ev: VaultEvent): Promise<void> {
    const [row] = await this.d.db
      .select()
      .from(intents)
      .where(and(eq(intents.userAddress, ev.user.toLowerCase()), eq(intents.intentId, ev.id)));
    if (!row) return; // not created through the preview API: nothing to execute
    if (ev.kind === 'submitted') {
      const same =
        row.detailsHash === ev.detailsHash &&
        row.amountUsdc === ev.amount.toString() &&
        Math.floor(row.expiry.getTime() / 1000) === Number(ev.expiry);
      if (row.status === 'previewed' && same) await this.go(row, 'signed', {});
    } else if (row.status === 'previewed' || row.status === 'signed') {
      await this.finish(row, ev.kind === 'cancelled' ? 'cancelled' : 'expired', {});
    }
  }

  async step(id: string): Promise<StepResult> {
    const [row] = await this.d.db.select().from(intents).where(eq(intents.id, id));
    if (!row) throw new Error(`unknown intent ${id}`);
    if (TERMINAL_INTENT_STATUSES.includes(row.status)) return 'done';
    switch (row.status) {
      case 'signed':
        return this.dispatch(row);
      case 'dispatched':
        return this.attest(row);
      case 'bridging':
        return this.mint(row);
      case 'bridged':
        return this.convert(row);
      case 'ordering':
        return this.order(row);
      case 'returning':
        return this.returnFunds(row);
      default:
        return 'wait'; // previewed: waits for the Vault event
    }
  }

  // ---------------------------------------------------------------- steps

  private async dispatch(row: IntentRow): Promise<StepResult> {
    const { vault } = this.d;
    const user = getAddress(row.userAddress);
    const id = row.intentId as Hex;
    const vs = await vault.intentStatus(user, id);
    if (vs === VAULT_STATUS.Cancelled) return this.finish(row, 'cancelled', {});
    if (vs === VAULT_STATUS.Expired) return this.finish(row, 'expired', {});
    if (vs !== VAULT_STATUS.Reserved && vs !== VAULT_STATUS.Dispatched)
      return this.finish(row, 'failed', { reason: `vault status ${vs}` });

    if (vs === VAULT_STATUS.Reserved && this.now() >= row.expiry) {
      await vault.expireIntent(user, id); // expiry refund: reserved funds go back to idle
      return this.finish(row, 'expired', {});
    }
    const wallet = await this.d.wallets.registeredWalletOf(user);
    if (!wallet) return this.finish(row, 'failed', { reason: 'no registered Deposit Wallet' });
    let dispatchTx: Hex | null = null;
    if (vs === VAULT_STATUS.Reserved) {
      // Ops pause (#23): hold new dispatches; funds stay reserved and the expiry refund above still applies.
      if (await isDispatchPaused(this.d.db, row.details.venueId)) return 'wait';
      if (!(await this.d.geoblock.allowed())) return 'wait'; // fail closed
      await this.d.wallets.openIntent({
        intentId: row.id,
        walletId: wallet.id,
        capUsdc: BigInt(row.amountUsdc),
      });
      dispatchTx = await vault.dispatch(user, id);
    } else {
      // Dispatched by an earlier run that died before recording it.
      dispatchTx = await vault.dispatchTx(user, id);
      if (!dispatchTx) return this.finish(row, 'failed', { reason: 'dispatch tx not found' });
    }
    return this.go(row, 'dispatched', { walletId: wallet.id, dispatchTx });
  }

  private async attest(row: IntentRow): Promise<StepResult> {
    const att = await this.d.iris.attestation(CCTP_DOMAIN.monad, row.ctx.dispatchTx as Hex);
    if (!att) return this.waiting(row);
    return this.go(row, 'bridging', {
      message: att.message,
      attestation: att.attestation,
      mintedUsdc: mintedAmount(att.message).toString(),
    });
  }

  private async mint(row: IntentRow): Promise<StepResult> {
    const { message, attestation } = row.ctx as { message: Hex; attestation: Hex };
    if (!(await this.d.polygon.messageUsed(message)))
      await this.d.polygon.receiveMessage(message, attestation);
    return this.go(row, 'bridged', {});
  }

  /** native USDC -> USDC.e -> pUSD in one relayer batch through the policy layer. */
  private async convert(row: IntentRow): Promise<StepResult> {
    if (!(await this.d.geoblock.allowed())) return 'wait';
    const { walletId } = row.ctx as { walletId: string };
    const wallet = await this.walletAddress(row);
    const minted = BigInt(row.ctx.mintedUsdc!);
    const minOut = (minted * (10_000n - this.slip)) / 10_000n;
    const bal = await this.d.polygon.balances(wallet);
    if (bal.native >= minted) {
      const { negRisk } = await this.d.books.asks(row.details);
      const { txId } = await this.d.wallets.submitSessionBatch({
        walletId,
        intentId: row.id,
        calls: buildConvertCalls({
          wallet,
          exchange: negRisk ? POLYGON.negRiskExchange : POLYGON.v2Exchange,
          amount: minted,
          minOut,
        }),
      });
      await this.d.relayer.waitConfirmed(txId);
    } else if (bal.pusd < minOut) {
      return this.waiting(row); // an earlier run already submitted; not settled yet
    }
    return this.go(row, 'ordering', { pusd: minOut.toString(), orderKey: `paras:${row.id}` });
  }

  private async order(row: IntentRow): Promise<StepResult> {
    const { ctx, details } = row;
    const pusd = BigInt(ctx.pusd!);
    const wallet = await this.walletAddress(row);
    const rest = details.remainder === 'rest';

    if (!ctx.orderId) {
      if (!(await this.d.geoblock.allowed())) return 'wait';
      if ((await this.d.polygon.balances(wallet)).pusd < pusd) return this.waiting(row);
      const { asks, fee } = await this.d.books.asks(details);
      // Max price + depth: nothing within the cap to buy now and no resting order wanted -> give the funds back.
      const { fill } = fillWithinMaxPrice({ asks, fee }, formatUnits(pusd, 6), details.maxPrice);
      if (!fill && !rest)
        return this.startReturn(row, pusd, 'failed', 'no liquidity within max price');
      await this.d.wallets.checkClob(ctx.walletId!, {
        kind: 'order',
        maker: wallet,
        signer: wallet,
      });
      const { orderId } = await this.d.clob.placeOrder({
        key: ctx.orderKey!,
        wallet,
        tokenId: details.tokenId,
        price: details.maxPrice,
        amountUsd: formatUnits(pusd, 6),
        type: rest ? 'GTC' : 'FAK',
      });
      return this.patch(row, { orderId });
    }

    const o = await this.d.clob.getOrder(ctx.orderId);
    const expired = this.now() >= row.expiry;
    if (o.open) {
      if (!expired) return 'wait';
      await this.d.clob.cancel(ctx.orderId); // expiry: stop resting, then settle what filled
      return 'progress';
    }
    const spent = parseUnits(o.spentUsd, 6);
    const remainder = pusd - spent;
    const filled = { filledShares: o.filledShares, spentUsdc: spent.toString() };
    const gotShares = Number(o.filledShares) > 0;
    if (remainder <= DUST && gotShares) return this.finish(row, 'filled', filled);
    await this.patch(row, filled);
    return this.startReturn(
      { ...row, ctx: { ...ctx, ...filled } },
      remainder,
      gotShares ? 'partially_filled' : expired ? 'expired' : 'failed',
      gotShares ? 'partial fill, remainder returned' : 'unfilled',
    );
  }

  /** pUSD -> USDC.e -> native -> CCTP burn to the Vault, attest, `Vault.settle`. */
  private async returnFunds(row: IntentRow): Promise<StepResult> {
    const { ctx } = row;
    const wallet = await this.walletAddress(row);
    const pusd = BigInt(ctx.returnPusd!);

    if (!ctx.returnRelayerTx) {
      if ((await this.d.polygon.balances(wallet)).pusd < pusd)
        return this.finish(row, 'failed', {
          reason: 'return submitted but not recorded; needs ops',
        });
      const { txId } = await this.d.wallets.submitSessionBatch({
        walletId: ctx.walletId!,
        intentId: row.id,
        calls: buildSweepCalls({
          wallet,
          vault: this.d.vault.address,
          pusdAmount: pusd,
          minNative: (pusd * (10_000n - this.slip)) / 10_000n,
        }),
      });
      return this.patch(row, { returnRelayerTx: txId });
    }
    if (!ctx.returnTx) {
      const { txHash } = await this.d.relayer.waitConfirmed(ctx.returnRelayerTx);
      if (!txHash) return this.finish(row, 'failed', { reason: 'relayer gave no tx hash' });
      return this.patch(row, { returnTx: txHash });
    }
    if (!ctx.returnMessage) {
      const att = await this.d.iris.attestation(CCTP_DOMAIN.polygon, ctx.returnTx as Hex);
      if (!att) return this.waiting(row);
      return this.patch(row, { returnMessage: att.message, returnAttestation: att.attestation });
    }
    const user = getAddress(row.userAddress);
    const id = row.intentId as Hex;
    if (!(await this.d.vault.messageUsed(ctx.returnMessage as Hex)))
      await this.d.vault.settle(ctx.returnMessage as Hex, ctx.returnAttestation as Hex, id);
    // Nothing was bought: write off the swap-slippage remainder so the Vault shows no in-flight claim.
    if (
      !(Number(ctx.filledShares ?? 0) > 0) &&
      (await this.d.vault.intentStatus(user, id)) === VAULT_STATUS.Dispatched
    )
      await this.d.vault.closeIntent(user, id);
    return this.finish(row, ctx.then!, {});
  }

  // ---------------------------------------------------------------- persistence

  private async walletAddress(row: IntentRow): Promise<Address> {
    const w = await this.d.wallets.registeredWalletOf(getAddress(row.userAddress));
    if (!w) throw new Error('Deposit Wallet missing');
    return getAddress(w.walletAddress);
  }

  private startReturn(
    row: IntentRow,
    amount: bigint,
    then: NonNullable<Ctx['then']>,
    reason: string,
  ): Promise<StepResult> {
    return this.go(row, 'returning', { returnPusd: amount.toString(), then, reason });
  }

  private waiting(row: IntentRow): Promise<StepResult> | StepResult {
    if (this.now().getTime() - row.updatedAt.getTime() <= (this.d.waitTimeoutMs ?? 30 * 60_000))
      return 'wait';
    return this.finish(row, 'failed', { reason: `timeout in ${row.status}` });
  }

  /** Same-status ctx update (an effect finished, the next step continues). */
  private async patch(row: IntentRow, ctx: Partial<Ctx>): Promise<StepResult> {
    await this.d.db
      .update(intents)
      .set({ ctx: sql`${intents.ctx} || ${JSON.stringify(ctx)}::jsonb`, updatedAt: this.now() })
      .where(and(eq(intents.id, row.id), eq(intents.status, row.status)));
    return 'progress';
  }

  private go(row: IntentRow, to: IntentStatus, ctx: Partial<Ctx>): Promise<StepResult> {
    return this.transition(row, to, ctx).then(() => 'progress');
  }

  private async finish(row: IntentRow, to: IntentStatus, ctx: Partial<Ctx>): Promise<StepResult> {
    if ((await this.transition(row, to, ctx)) && NOTIFY.includes(to)) {
      const c = { ...row.ctx, ...ctx };
      const text: Record<string, string> = {
        filled: `Your bet filled: ${c.filledShares} shares.`,
        partially_filled: `Your bet partly filled (${c.filledShares} shares); the rest was returned to your Vault.`,
        expired: 'Your bet expired unfilled; funds are back in your Vault.',
        failed: `Your bet failed${c.reason ? `: ${c.reason}` : ''}. Check its status.`,
      };
      await notify(this.d.db, this.d.mailer, {
        ownerKey: `u:${row.userId}`,
        kind: 'intent_update',
        dedupeKey: `intent:${row.id}:${to}`,
        title: `Bet ${to.replace('_', ' ')}`,
        body: text[to]!,
      });
    }
    return 'done';
  }

  /** Compare-and-set on the status the step started from; a concurrent runner loses harmlessly. */
  private async transition(row: IntentRow, to: IntentStatus, ctx: Partial<Ctx>): Promise<boolean> {
    return this.d.db.transaction(async (tx) => {
      const moved = await tx
        .update(intents)
        .set({
          status: to,
          ctx: sql`${intents.ctx} || ${JSON.stringify(ctx)}::jsonb`,
          updatedAt: this.now(),
        })
        .where(and(eq(intents.id, row.id), eq(intents.status, row.status)))
        .returning({ id: intents.id });
      if (!moved.length) return false;
      await tx.insert(intentEvents).values({
        intentRowId: row.id,
        status: to,
        note: ctx.reason ? { reason: ctx.reason } : {},
        at: this.now(),
      });
      return true;
    });
  }
}
