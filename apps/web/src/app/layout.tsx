import type { Metadata } from 'next';
import { IBM_Plex_Mono, Shippori_Mincho_B1, Zen_Kaku_Gothic_New } from 'next/font/google';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import { themeScript } from '@/components/theme-toggle';
import './globals.css';

const mincho = Shippori_Mincho_B1({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-mincho',
});
const body = Zen_Kaku_Gothic_New({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-body',
});
const code = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-code' });

const description =
  'Compare prediction market odds across Venues, follow a personal Feed, and bet from one USDC Vault on Monad.';

export const metadata: Metadata = {
  metadataBase: new URL('https://paraspredic.fun'),
  title: { default: 'Paras', template: '%s · Paras' },
  description,
  applicationName: 'Paras',
  openGraph: { type: 'website', siteName: 'Paras', url: '/', title: 'Paras', description },
  twitter: { card: 'summary_large_image', title: 'Paras', description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${mincho.variable} ${body.variable} ${code.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
