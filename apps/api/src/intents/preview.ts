import type { AdapterRegistry } from '@paras/adapters';
import { schema, type Database } from '@paras/db';
import {
  POLYMARKET_ROUTE_OVERHEAD_BPS,
  RISK_DISCLOSURES,
  computeRoute,
  intentDetailsHash,
  intentTypedData,
  parseDecimal,
  vaultIneligibleReasons,
  venueAvailabilityFor,
  type IntentDetails,
  type RouteVenue,
} from '@paras/domain';
import type { IntentPreview, IntentPreviewRequest, z } from '@paras/shared';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getAddress, parseUnits, type Hex } from 'viem';
import { HttpError, notFound } from '../errors.js';
import { fetchBooks } from '../events/books.js';
import { loadOutcomeGroups } from '../events/compare.js';
import type { VaultReader } from '../vault.js';

const { disclosureAcks, intents } = schema;

export interface PreviewDeps {
  db: Database;
  adapters: AdapterRegistry;
  vault: VaultReader;
  now: () => Date;
  warn: (err: unknown, venueId: string) => void;
}

/** Countries governing the request: live IP country plus the User's attestation. */
export interface Countries {
  ipCountry: string | null;
  attestedCountry: string | null;
  countries: string[];
}

/**
 * Builds the Intent preview and records the \`previewed\` Intent. Shared by the preview endpoint and
 * conditional orders (#93), which pass the IP country captured when the order was created.
 */
export async function previewIntentFor(
  d: PreviewDeps,
  userId: string,
  body: z.output<typeof IntentPreviewRequest>,
  vc: Countries,
): Promise<IntentPreview> {
  const { db, adapters } = d;
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
  const books = await fetchBooks(adapters, rows, d.warn);
  const venues: RouteVenue[] = rows.map((r) => ({
    venueId: r.venue.id,
    caps: r.venue.capabilities,
    fee: r.market.fee,
    asks: books.get(`${r.venue.id}|${r.outcome.externalId}`)?.asks ?? [],
    redirectUrl: r.market.url,
    overheadBps: r.venue.id === 'polymarket' ? POLYMARKET_ROUTE_OVERHEAD_BPS : 0,
  }));

  const [ack] = await db
    .select()
    .from(disclosureAcks)
    .where(
      and(eq(disclosureAcks.userId, userId), eq(disclosureAcks.version, RISK_DISCLOSURES.version)),
    );
  const blockers: string[] = vaultIneligibleReasons({
    ipCountry: vc.ipCountry,
    attestedCountry: vc.attestedCountry,
    disclosuresAcknowledged: Boolean(ack),
    venues: venues.map((x) => venueAvailabilityFor(x.venueId, x.caps, vc.countries)),
  });
  const amountBase = parseUnits(body.amount, 6);
  const [acct] = await d.vault.accounts([getAddress(body.user)]);
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
  const expiry = new Date(d.now().getTime() + body.expiresInMinutes * 60_000);
  const [created] = await db
    .insert(intents)
    .values({
      userId: userId,
      userAddress: body.user,
      intentId,
      amountUsdc: amountBase.toString(),
      expiry,
      details,
      detailsHash,
    })
    .returning({ id: intents.id });
  const t = intentTypedData({
    vault: d.vault.vault,
    chainId: d.vault.chainId,
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
}
