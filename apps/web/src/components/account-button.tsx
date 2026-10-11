'use client';

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
      <button onClick={signOut} className={btn} title={user.emails[0] ?? user.wallets[0]?.address}>
        Sign out
      </button>
    );
  return (
    <button onClick={signIn} className={btn}>
      Sign in
    </button>
  );
}
