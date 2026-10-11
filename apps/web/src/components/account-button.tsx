'use client';

import Link from 'next/link';
import { useSession } from './providers';

const btn = 'rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50';

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
        <Link href="/settings/connected-apps" className="text-sm text-muted hover:text-fg">
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
