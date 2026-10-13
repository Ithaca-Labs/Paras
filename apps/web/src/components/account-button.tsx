'use client';

import Link from 'next/link';
import { useSession } from './providers';

const btn =
  'rounded-full bg-accent px-4 py-1.5 shadow-sm ring-1 ring-gold/40 transition font-display text-[0.95rem] font-semibold tracking-wide text-accent-fg hover:brightness-110 disabled:opacity-50';

export function AccountButton() {
  const { configured, loading, user, signIn, signOut } = useSession();
  if (!configured)
    return (
      <button
        disabled
        className={btn}
        title="Set NEXT_PUBLIC_PRIVY_APP_ID (or PRIVY_APP_ID) in the repo .env"
      >
        Sign in unavailable
      </button>
    );
  if (loading) return <span className="text-sm text-muted">…</span>;
  if (user)
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/settings/connected-apps"
          className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg"
        >
          Connected apps
        </Link>
        <button
          onClick={signOut}
          className={btn}
          title={user.emails[0] ?? user.wallets[0]?.address}
        >
          Sign out
        </button>
      </div>
    );
  return (
    <button onClick={signIn} className={btn}>
      Sign in
    </button>
  );
}
