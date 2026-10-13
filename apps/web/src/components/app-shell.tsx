import Image from 'next/image';
import Link from 'next/link';
import { AccountButton } from './account-button';
import { Nav } from './nav';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';

/** Header + content frame. Pages render only their own content inside `<main>`; never add chrome. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5">
          <Link href="/feed" aria-label="Paras home" className="shrink-0">
            <Image
              src="/brand/wordmark.png"
              alt="Paras"
              width={690}
              height={300}
              priority
              className="wordmark h-8 w-auto"
            />
          </Link>
          <Nav />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5 text-xs text-muted">
          <Image
            src="/brand/monogram.png"
            alt=""
            width={250}
            height={265}
            className="wordmark h-6 w-auto"
          />
          Prediction markets, side by side.
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 border-b border-border pb-5">
      <h1 className="text-3xl leading-tight font-extrabold text-balance md:text-4xl">{title}</h1>
      {children && <p className="mt-2 text-sm text-muted">{children}</p>}
    </div>
  );
}
