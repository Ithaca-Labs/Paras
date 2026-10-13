import type { Metadata } from 'next';
import { Cormorant_Garamond, Inter, JetBrains_Mono } from 'next/font/google';
import { AppShell } from '@/components/app-shell';
import { PointerFx } from '@/components/pointer-fx';
import { Providers } from '@/components/providers';
import './globals.css';

const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-serif',
});
const body = Inter({ subsets: ['latin'], variable: '--font-body' });
const code = JetBrains_Mono({ subsets: ['latin'], variable: '--font-code' });

export const metadata: Metadata = {
  title: { default: 'Paras', template: '%s · Paras' },
  description: 'Prediction market aggregator and discovery layer on Monad.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${body.variable} ${code.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
        <PointerFx />
      </body>
    </html>
  );
}
