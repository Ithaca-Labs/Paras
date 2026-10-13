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
      <header className="sticky top-3 z-20 px-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 nav-float rounded-[1.75rem] py-2 pr-2 pl-5">
          <Link href="/feed" aria-label="Paras home" className="shrink-0">
            <Image
              src="/brand/wordmark.png"
              alt="Paras"
              width={690}
              height={300}
              priority
              className="wordmark nav-wordmark h-7 w-auto"
            />
          </Link>
          <Nav />
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-0.5 nav-tray rounded-full p-1">
              <ThemeToggle />
              <NotificationBell />
            </div>
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-8">{children}</main>
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
