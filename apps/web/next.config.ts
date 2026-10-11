import type { NextConfig } from 'next';

// Ids live in the repo-root .env; Next only reads apps/web/.env*.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no root .env (CI) */
}

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const config: NextConfig = {
  transpilePackages: ['@paras/shared'],
  // The Privy app id is public; the root .env names it PRIVY_APP_ID.
  env: {
    NEXT_PUBLIC_PRIVY_APP_ID:
      process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? process.env.PRIVY_APP_ID ?? '',
  },
  // packages/shared imports './x.js' for './x.ts'; Turbopack can't alias that, so we run webpack.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
  // Same-origin API: the session cookie works without CORS.
  rewrites: async () => [{ source: '/v1/:path*', destination: `${API_URL}/v1/:path*` }],
};
export default config;
