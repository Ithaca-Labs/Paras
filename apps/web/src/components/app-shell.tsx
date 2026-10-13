import Image from 'next/image';
import Link from 'next/link';
import { AccountButton } from './account-button';
import { Nav } from './nav';
import { NotificationBell } from './notification-bell';

/** Header + content frame. Pages render only their own content inside `<main>`; never add chrome. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-2.5">
          <Link
            href="/feed"
            aria-label="Paras home"
            className="group shrink-0 transition-transform hover:-rotate-1"
          >
            <Image
              src="/brand/wordmark.png"
              alt="Paras"
              width={690}
              height={300}
              priority
              className="wordmark h-9 w-auto"
            />
          </Link>
          <Nav />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <AccountButton />
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="relative mt-12 overflow-hidden border-t border-border">
        <Image
          src="/brand/cloud.png"
          alt=""
          width={330}
          height={230}
          className="drift pointer-events-none absolute -top-6 -right-10 w-64 opacity-50"
        />
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-6 text-xs text-muted">
          <Image
            src="/brand/monogram.png"
            alt=""
            width={250}
            height={265}
            className="wordmark h-7 w-auto"
          />
          <span className="tracking-[0.28em] uppercase">Every Venue · one view</span>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-4xl font-semibold">{title}</h1>
      <div className="mt-2 h-0.5 w-16 rounded-full bg-gradient-to-r from-gold to-seal brush" />
      {children && <p className="mt-3 text-sm text-muted">{children}</p>}
    </div>
  );
}
