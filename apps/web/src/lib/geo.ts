/** CDN country headers the API trusts (apps/api headerGeo). Vercel first: web is not behind Cloudflare. */
export const GEO_HEADERS = ['x-vercel-ip-country', 'cf-ipcountry'] as const;

/**
 * Country header to send the API. `DEV_COUNTRY` (ISO alpha-2) overrides only outside production,
 * so the Vault gate is demoable on localhost where no CDN sets a country.
 */
export function geoOverride(
  incoming: Pick<Headers, 'get'>,
  env: { DEV_COUNTRY?: string; NODE_ENV?: string; GEO_SECRET?: string } = process.env,
): Record<string, string> {
  const dev = env.NODE_ENV !== 'production' ? env.DEV_COUNTRY?.trim().toUpperCase() : undefined;
  if (dev) return { 'cf-ipcountry': dev };
  // With GEO_SECRET the API trusts our country over the one Cloudflare stamps on us (#136). Own
  // header name: Vercel drops x-vercel-* on the /v1 rewrite to the API (#146).
  const secret = env.GEO_SECRET;
  for (const h of GEO_HEADERS) {
    const v = incoming.get(h);
    if (v) return secret ? { 'x-paras-country': v, 'x-paras-geo-secret': secret } : { [h]: v };
  }
  return secret ? { 'x-paras-geo-secret': secret } : {};
}
