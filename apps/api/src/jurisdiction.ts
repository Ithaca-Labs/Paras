import { timingSafeEqual } from 'node:crypto';
import { schema, type Database } from '@paras/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './auth/guard.js';

/** Resolves the caller's country (ISO alpha-2, uppercase) or null. Injectable via AppDeps.geo. */
export type GeoResolver = (req: FastifyRequest) => string | null;

/**
 * Default: trust the CDN's country header (Cloudflare `CF-IPCountry`, Vercel `X-Vercel-IP-Country`).
 * Free and offline (no GeoIP DB licence). Only safe when the API is reachable solely through that
 * CDN, which must overwrite these headers; otherwise callers can spoof them.
 */
export const headerGeo: GeoResolver = (req) =>
  country(req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country']);

function country(raw: string | string[] | undefined) {
  const c = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase();
  // XX = unknown, T1 = Tor (Cloudflare)
  return c && /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

/**
 * Web (Vercel) -> API crosses Cloudflare, which stamps Vercel's datacenter country (#136). The web
 * proves itself with GEO_SECRET (`x-paras-geo-secret`); then only the visitor's
 * `x-vercel-ip-country` counts (absent = unknown, fail closed). Other callers: `headerGeo`.
 */
export function trustedGeo(secret: string): GeoResolver {
  const want = Buffer.from(secret);
  return (req) => {
    const raw = req.headers['x-paras-geo-secret'];
    const given = Buffer.from(typeof raw === 'string' ? raw : '');
    const fromWeb = given.length === want.length && timingSafeEqual(given, want);
    return fromWeb ? country(req.headers['x-vercel-ip-country']) : headerGeo(req);
  };
}

/** Countries that govern the caller: IP country plus the signed-in User's attestation. */
export async function viewerCountries(
  db: Database,
  geo: GeoResolver,
  req: FastifyRequest,
  auth: AuthContext | null,
) {
  const ipCountry = geo(req);
  let attestedCountry: string | null = null;
  if (auth) {
    const [u] = await db
      .select({ c: schema.users.attestedCountry })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId));
    attestedCountry = u?.c ?? null;
  }
  return {
    ipCountry,
    attestedCountry,
    countries: [ipCountry, attestedCountry].filter((c): c is string => c !== null),
  };
}
