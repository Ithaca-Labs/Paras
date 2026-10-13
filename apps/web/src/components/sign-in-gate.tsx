'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from './providers';

/** Prompts sign-in (Privy modal, no navigation), then re-renders the server page with the new session. */
export function SignInGate({ message }: { message: string }) {
  const { configured, loading, user, signIn } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (user) router.refresh();
  }, [user, router]);
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6">
      <p className="text-sm">{message}</p>
      <button
        onClick={signIn}
        disabled={!configured || loading}
        className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
      >
        Sign in
      </button>
    </div>
  );
}
