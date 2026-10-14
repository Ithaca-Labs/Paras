import type { MetadataRoute } from 'next';

// shortcut: public static routes only; add Events once there is a cheap id listing.
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/explore', '/feed'].map((path) => ({ url: `https://paraspredic.fun${path}` }));
}
