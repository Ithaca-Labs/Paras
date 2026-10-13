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

export const metadata: Metadata = {
  title: { default: 'Paras', template: '%s · Paras' },
  description: 'Prediction market aggregator and discovery layer on Monad.',
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
