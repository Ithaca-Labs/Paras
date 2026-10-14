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
  // Lets the API trust our x-vercel-ip-country over the country Cloudflare stamps on us (#136).
  const proof: Record<string, string> = env.GEO_SECRET
    ? { 'x-paras-geo-secret': env.GEO_SECRET }
    : {};
  for (const h of GEO_HEADERS) {
    const v = incoming.get(h);
    if (v) return { [h]: v, ...proof };
  }
  return proof;
}
