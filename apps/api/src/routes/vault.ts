import { schema } from '@paras/db';
import {
  POLYMARKET_ROUTE_OVERHEAD_BPS,
  RISK_DISCLOSURES,
  computeRoute,
  intentDetailsHash,
  intentTypedData,
  parseDecimal,
  registerTypedData,
  vaultIneligibleReasons,
  venueAvailabilityFor,
  type IntentDetails,
  type RouteVenue,
} from '@paras/domain';
import { apiRoutes, type DepositWalletState } from '@paras/shared';
import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { formatUnits, getAddress, parseUnits, verifyTypedData, type Hex } from 'viem';
import { HttpError, notFound } from '../errors.js';
import { fetchBooks } from '../events/books.js';
import { loadOutcomeGroups } from '../events/compare.js';
import { implement } from '../implement.js';
import { headerGeo, viewerCountries } from '../jurisdiction.js';
import type { RoutePlugin } from './index.js';

const usdc = (n: bigint) => formatUnits(n, 6);
const POLYGON_CHAIN = '137';
const { depositWallets, disclosureAcks, intentEvents, intents, walletLinks, walletRequests } =
  schema;

export const vaultRoutes: RoutePlugin = (
  app,
  { db, vault, adapters, geo = headerGeo, now = () => new Date() },
) => {
  const needVault = () => {
    if (!vault) throw new HttpError(503, 'vault_unavailable', 'Vault chain is not configured');
    return vault;
  };
  const requireLinked = async (userId: string, address: string) => {
    const [l] = await db
      .select({ a: walletLinks.address })
      .from(walletLinks)
      .where(and(eq(walletLinks.userId, userId), eq(walletLinks.address, address.toLowerCase())));
    if (!l) throw new HttpError(403, 'wallet_not_linked', 'Address is not linked to your account');
  };

  implement(
    app,
    apiRoutes.getVaultBalances,
    async (_req, { auth }) => {
      if (!vault) throw new HttpError(503, 'vault_unavailable', 'Vault chain is not configured');
      const links = await db
        .select({ address: schema.walletLinks.address })
        .from(schema.walletLinks)
        .where(eq(schema.walletLinks.userId, auth.userId));
      const addrs = links.map((l) => getAddress(l.address));
      const rows = addrs.length ? await vault.accounts(addrs) : [];
      const sum = { idle: 0n, reserved: 0n, inFlight: 0n };
      for (const r of rows) {
        sum.idle += r.idle;
        sum.reserved += r.reserved;
        sum.inFlight += r.inFlight;
      }
      return {
        vault: vault.vault.toLowerCase(),
        chainId: vault.chainId,
        total: {
          idle: usdc(sum.idle),
          reserved: usdc(sum.reserved),
          inFlight: usdc(sum.inFlight),
        },
        accounts: rows.map((r, i) => ({
          address: addrs[i]!.toLowerCase(),
          idle: usdc(r.idle),
          reserved: usdc(r.reserved),
          inFlight: usdc(r.inFlight),
          depositWallet: r.depositWallet?.toLowerCase() ?? null,
        })),
      };
    },
    { auth: 'required', scope: 'portfolio:read' },
  );

  // ------------------------------------------------------------ Intent preview (#20)

  implement(
    app,
    apiRoutes.previewIntent,
    async ({ body }, { auth, request }) => {
      const v = needVault();
      await requireLinked(auth.userId, body.user);
      const stake = parseDecimal(body.amount);
      const cap = parseDecimal(body.maxPrice);
      if (stake <= 0n) throw new HttpError(400, 'validation_error', 'amount must be positive');
      if (cap <= 0n || cap > parseDecimal('1'))
        throw new HttpError(400, 'validation_error', 'maxPrice must be in (0, 1]');

      const groups = await loadOutcomeGroups(db, body.eventId);
      if (!groups.size) throw notFound('Event');
      const rows = groups
        .get(body.outcome.trim().toLowerCase())
        ?.filter((r) => r.market.status === 'open');
      if (!rows?.length) throw notFound('Outcome');
      const books = await fetchBooks(adapters, rows, (err, venueId) =>
        app.log.warn({ err, venueId }, 'order book fetch failed'),
      );
      const venues: RouteVenue[] = rows.map((r) => ({
        venueId: r.venue.id,
        caps: r.venue.capabilities,
        fee: r.market.fee,
        asks: books.get(`${r.venue.id}|${r.outcome.externalId}`)?.asks ?? [],
        redirectUrl: r.market.url,
        overheadBps: r.venue.id === 'polymarket' ? POLYMARKET_ROUTE_OVERHEAD_BPS : 0,
      }));

      const vc = await viewerCountries(db, geo, request, auth);
      const [ack] = await db
        .select()
        .from(disclosureAcks)
        .where(
          and(
            eq(disclosureAcks.userId, auth.userId),
            eq(disclosureAcks.version, RISK_DISCLOSURES.version),
          ),
        );
      const blockers: string[] = vaultIneligibleReasons({
        ipCountry: vc.ipCountry,
        attestedCountry: vc.attestedCountry,
        disclosuresAcknowledged: Boolean(ack),
        venues: venues.map((x) => venueAvailabilityFor(x.venueId, x.caps, vc.countries)),
      });
      const amountBase = parseUnits(body.amount, 6);
      const [acct] = await v.accounts([getAddress(body.user)]);
      if (!acct?.depositWallet) blockers.push('deposit_wallet_not_registered');
      if ((acct?.idle ?? 0n) < amountBase) blockers.push('insufficient_idle_balance');

      const result = computeRoute({
        venues,
        stake: body.amount,
        maxPrice: body.maxPrice,
        countries: vc.countries,
      });
      const none = {
        blockers,
        route: null,
        noRoute: null,
        hint: null,
        intent: null,
      };
      if (result.kind === 'none') {
        return {
          ...none,
          noRoute: {
            reason: result.reason,
            redirects: result.redirects.map((x) => ({
              venueId: x.venueId,
              redirectUrl: x.redirectUrl,
              shares: x.fill?.shares ?? null,
              effectivePrice: x.fill?.effectivePrice ?? null,
            })),
          },
        };
      }
      const { route, hint } = result;
      const row = rows.find((r) => r.venue.id === route.venueId)!;
      const out = {
        ...none,
        hint,
        route: {
          venueId: route.venueId,
          marketId: row.market.id,
          outcomeId: row.outcome.id,
          maxPrice: body.maxPrice,
          expected: {
            shares: route.fill.shares,
            avgPrice: route.fill.avgPrice,
            fees: route.fill.fees,
            overhead: route.overhead,
            spent: route.fill.spent,
            effectivePrice: route.fill.effectivePrice,
            unspent: route.fill.unspent,
          },
        },
      };
      if (blockers.length) return out;

      const details: IntentDetails = {
        eventId: body.eventId,
        marketId: row.market.id,
        outcomeId: row.outcome.id,
        venueId: route.venueId,
        tokenId: row.outcome.externalId,
        maxPrice: body.maxPrice,
        remainder: body.remainder,
      };
      const detailsHash = intentDetailsHash(details);
      const intentId = `0x${randomBytes(32).toString('hex')}` as Hex;
      const expiry = new Date(now().getTime() + body.expiresInMinutes * 60_000);
      const [created] = await db
        .insert(intents)
        .values({
          userId: auth.userId,
          userAddress: body.user,
          intentId,
          amountUsdc: amountBase.toString(),
          expiry,
          details,
          detailsHash,
        })
        .returning({ id: intents.id });
      const t = intentTypedData({
        vault: v.vault,
        chainId: v.chainId,
        user: body.user,
        id: intentId,
        amount: amountBase,
        expiry: BigInt(Math.floor(expiry.getTime() / 1000)),
        detailsHash,
      });
      return {
        ...out,
        intent: {
          id: created!.id,
          expiresAt: expiry.toISOString(),
          detailsHash,
          typedData: {
            ...t,
            domain: { ...t.domain, verifyingContract: t.domain.verifyingContract.toLowerCase() },
            message: {
              user: t.message.user,
              id: t.message.id,
              amount: t.message.amount.toString(),
              expiry: t.message.expiry.toString(),
              detailsHash: t.message.detailsHash,
            },
          },
        },
      };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.getIntent,
    async ({ params }, { auth }) => {
      const [i] = await db
        .select()
        .from(intents)
        .where(and(eq(intents.id, params.id), eq(intents.userId, auth.userId)));
      if (!i) throw notFound('Intent');
      const events = await db
        .select()
        .from(intentEvents)
        .where(eq(intentEvents.intentRowId, i.id))
        .orderBy(asc(intentEvents.id));
      const reason = (n: Record<string, unknown>) =>
        typeof n.reason === 'string' ? n.reason : null;
      return {
        id: i.id,
        status: i.status,
        amount: usdc(BigInt(i.amountUsdc)),
        expiresAt: i.expiry.toISOString(),
        details: {
          eventId: i.details.eventId,
          marketId: i.details.marketId,
          outcomeId: i.details.outcomeId,
          venueId: i.details.venueId,
          maxPrice: i.details.maxPrice,
          remainder: i.details.remainder,
        },
        filledShares: i.ctx.filledShares ?? null,
        spent: i.ctx.spentUsdc ? usdc(BigInt(i.ctx.spentUsdc)) : null,
        reason: i.ctx.reason ?? null,
        timeline: [
          { status: 'previewed' as const, at: i.createdAt.toISOString(), reason: null },
          ...events.map((e) => ({
            status: e.status,
            at: e.at.toISOString(),
            reason: reason(e.note),
          })),
        ],
      };
    },
    { auth: 'required' },
  );

  // ------------------------------------------------------------ Deposit Wallet registration (#57)

  async function walletState(userId: string): Promise<DepositWalletState> {
    const v = needVault();
    const [req] = await db.select().from(walletRequests).where(eq(walletRequests.userId, userId));
    const [w] = await db
      .select()
      .from(depositWallets)
      .where(and(eq(depositWallets.userId, userId), eq(depositWallets.chainId, POLYGON_CHAIN)));
    const status = w && w.status !== 'pending' ? w.status : w || req ? 'requested' : 'none';
    const owner = (w?.ownerAddress ?? req?.owner ?? null) as `0x${string}` | null;
    const typed =
      w?.status === 'deployed' && owner
        ? registerTypedData({
            vault: v.vault,
            chainId: v.chainId,
            user: owner,
            wallet: w.walletAddress,
          })
        : null;
    return {
      status,
      owner,
      wallet: (w?.walletAddress ?? null) as `0x${string}` | null,
      registerTypedData: typed && {
        ...typed,
        domain: {
          ...typed.domain,
          verifyingContract: typed.domain.verifyingContract.toLowerCase() as `0x${string}`,
        },
      },
      signatureReceived: Boolean(req?.signature),
    };
  }

  implement(app, apiRoutes.getDepositWallet, (_req, { auth }) => walletState(auth.userId), {
    auth: 'required',
  });

  implement(
    app,
    apiRoutes.requestDepositWallet,
    async ({ body }, { auth }) => {
      needVault();
      await requireLinked(auth.userId, body.owner);
      const state = await walletState(auth.userId);
      if (state.owner && state.owner.toLowerCase() !== body.owner)
        throw new HttpError(
          409,
          'owner_locked',
          'This account already has a Deposit Wallet request for another owner',
        );
      if (body.signature) {
        if (state.status !== 'deployed' || !state.registerTypedData)
          throw new HttpError(
            409,
            'wallet_not_deployed',
            'Deposit Wallet is not deployed yet; poll GET first',
          );
        const t = state.registerTypedData;
        const ok = await verifyTypedData({
          address: getAddress(body.owner),
          signature: body.signature as Hex,
          domain: { ...t.domain, verifyingContract: t.domain.verifyingContract as Hex },
          types: t.types,
          primaryType: t.primaryType,
          message: t.message,
        }).catch(() => false);
        if (!ok)
          throw new HttpError(
            400,
            'bad_signature',
            'Signature does not match the registration typed data',
          );
      }
      await db
        .insert(walletRequests)
        .values({ userId: auth.userId, owner: body.owner, signature: body.signature ?? null })
        .onConflictDoUpdate({
          target: walletRequests.userId,
          set: {
            updatedAt: now(),
            ...(body.signature && { signature: body.signature }),
          },
        });
      return walletState(auth.userId);
    },
    { auth: 'required' },
  );
};
