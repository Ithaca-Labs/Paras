/** CDN country headers the API trusts (apps/api headerGeo). */
export const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country'] as const;

/**
 * Country header to send the API. `DEV_COUNTRY` (ISO alpha-2) overrides only outside production,
 * so the Vault gate is demoable on localhost where no CDN sets a country.
 */
export function geoOverride(
  incoming: Pick<Headers, 'get'>,
  env: { DEV_COUNTRY?: string; NODE_ENV?: string } = process.env,
): Record<string, string> {
  const dev = env.NODE_ENV !== 'production' ? env.DEV_COUNTRY?.trim().toUpperCase() : undefined;
  if (dev) return { 'cf-ipcountry': dev };
  for (const h of GEO_HEADERS) {
    const v = incoming.get(h);
    if (v) return { [h]: v };
  }
  return {};
}
