import { defineRoute } from '../route.js';
import { Availability, VenueId } from '../venue.js';
import { z } from '../zod.js';

const Country = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'ISO 3166-1 alpha-2')
  .transform((c) => c.toUpperCase());

export const Disclosures = z.object({
  /** Changes whenever the text changes; users must acknowledge the current one. */
  version: z.string(),
  items: z.array(z.object({ id: z.string(), title: z.string(), body: z.string() })),
});
export type Disclosures = z.infer<typeof Disclosures>;

export const getDisclosures = defineRoute({
  method: 'get',
  path: '/v1/disclosures',
  operationId: 'getDisclosures',
  summary: 'Current Vault risk disclosures (versioned)',
  tags: ['jurisdiction'],
  request: {},
  response: Disclosures,
});

export const acknowledgeDisclosures = defineRoute({
  method: 'post',
  path: '/v1/me/disclosures',
  operationId: 'acknowledgeDisclosures',
  summary:
    'Acknowledge the current risk disclosures. 409 stale_disclosures if version is not current',
  tags: ['jurisdiction'],
  request: { body: z.object({ version: z.string() }) },
  response: z.object({ version: z.string(), ackedAt: z.iso.datetime() }),
});

export const attestJurisdiction = defineRoute({
  method: 'post',
  path: '/v1/me/jurisdiction',
  operationId: 'attestJurisdiction',
  summary: 'Self-attest country of residence (required before Vault eligibility)',
  tags: ['jurisdiction'],
  request: { body: z.object({ country: Country }) },
  response: z.object({ country: z.string(), attestedAt: z.iso.datetime() }),
});

export const IneligibleReason = z.enum([
  'country_unknown',
  'attestation_required',
  'country_mismatch',
  'no_routable_venue',
  'disclosures_not_acknowledged',
]);

export const VaultEligibility = z.object({
  eligible: z.boolean(),
  reasons: z.array(IneligibleReason),
  /** Country from the CDN geo header; null when absent. */
  ipCountry: z.string().nullable(),
  attestedCountry: z.string().nullable(),
  disclosuresVersion: z.string(),
  disclosuresAcknowledged: z.boolean(),
  venues: z.array(z.object({ venueId: VenueId, name: z.string(), availability: Availability })),
});
export type VaultEligibility = z.infer<typeof VaultEligibility>;

export const getVaultEligibility = defineRoute({
  method: 'get',
  path: '/v1/vault/eligibility',
  operationId: 'getVaultEligibility',
  summary:
    'Whether the signed-in User may use the Vault: needs a known, attested, matching, non-restricted ' +
    'country and acknowledged disclosures. Ineligible answers eligible=false with reasons',
  tags: ['jurisdiction'],
  request: {},
  response: VaultEligibility,
});
