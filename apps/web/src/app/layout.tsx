import type { Metadata } from 'next';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import './globals.css';

const body = Inter({ subsets: ['latin'], variable: '--font-body' });
const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: { default: 'Paras', template: '%s · Paras' },
  description: 'Prediction market aggregator and discovery layer on Monad.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${serif.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
