import { RISK_DISCLOSURES, vaultIneligibleReasons, venueAvailabilityFor } from '@paras/domain';
import { schema } from '@paras/db';
import { apiRoutes } from '@paras/shared';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../errors.js';
import { implement } from '../implement.js';
import { headerGeo, viewerCountries } from '../jurisdiction.js';
import type { RoutePlugin } from './index.js';

const { users, disclosureAcks, venues } = schema;

export const jurisdictionRoutes: RoutePlugin = (
  app,
  { db, geo = headerGeo, now = () => new Date() },
) => {
  implement(app, apiRoutes.getDisclosures, () => RISK_DISCLOSURES);

  implement(
    app,
    apiRoutes.acknowledgeDisclosures,
    async ({ body }, { auth }) => {
      if (body.version !== RISK_DISCLOSURES.version) {
        throw new HttpError(
          409,
          'stale_disclosures',
          'Disclosures changed; fetch and re-acknowledge',
        );
      }
      const ackedAt = now();
      await db
        .insert(disclosureAcks)
        .values({ userId: auth.userId, version: body.version, ackedAt })
        .onConflictDoNothing();
      return { version: body.version, ackedAt: ackedAt.toISOString() };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.attestJurisdiction,
    async ({ body }, { auth }) => {
      const attestedAt = now();
      await db
        .update(users)
        .set({ attestedCountry: body.country, attestedAt })
        .where(eq(users.id, auth.userId));
      return { country: body.country, attestedAt: attestedAt.toISOString() };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.getVaultEligibility,
    async (_req, { request, auth }) => {
      const v = await viewerCountries(db, geo, request, auth);
      const [ack] = await db
        .select()
        .from(disclosureAcks)
        .where(
          and(
            eq(disclosureAcks.userId, auth.userId),
            eq(disclosureAcks.version, RISK_DISCLOSURES.version),
          ),
        );
      const rows = await db.select().from(venues);
      const venueList = rows.map((r) => ({
        venueId: r.id,
        name: r.name,
        availability: venueAvailabilityFor(r.id, r.capabilities, v.countries),
      }));
      const reasons = vaultIneligibleReasons({
        ipCountry: v.ipCountry,
        attestedCountry: v.attestedCountry,
        disclosuresAcknowledged: Boolean(ack),
        venues: venueList.map((x) => x.availability),
      });
      return {
        eligible: reasons.length === 0,
        reasons,
        ipCountry: v.ipCountry,
        attestedCountry: v.attestedCountry,
        disclosuresVersion: RISK_DISCLOSURES.version,
        disclosuresAcknowledged: Boolean(ack),
        venues: venueList,
      };
    },
    { auth: 'required' },
  );
};
