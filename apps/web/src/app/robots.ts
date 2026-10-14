import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/settings', '/oauth', '/magic', '/orders', '/portfolio', '/vault'],
    },
    sitemap: 'https://paraspredic.fun/sitemap.xml',
  };
}
