import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Paras',
    short_name: 'Paras',
    description: 'Compare prediction market odds across Venues.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f1e6',
    theme_color: '#1e2b3f',
    icons: [
      { src: '/icon.png', sizes: '64x64', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/app-icon.png', sizes: '262x262', type: 'image/png' },
    ],
  };
}
