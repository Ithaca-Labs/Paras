import Link from 'next/link';
import { AccountButton } from './account-button';
import { Nav } from './nav';
import { NotificationBell } from './notification-bell';

/** Header + content frame. Pages render only their own content inside `<main>`; never add chrome. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/feed" aria-label="Paras" className="wordmark h-9 w-24 shrink-0" />
          <Nav />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}
