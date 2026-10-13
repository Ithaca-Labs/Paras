'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from './providers';
import { ErrorState } from './states';

const SCOPE_TEXT: Record<string, string> = {
  'markets:read': 'Search and compare prediction markets',
  'feed:read': 'Read your personalized Feed',
  'portfolio:read': 'Read your Vault balances',
};

type Params = Record<string, string | undefined>;

/** Allow/Deny for an MCP client. Posts the decision, then sends the browser to the returned redirect. */
export function ConsentForm({
  clientName,
  scopes,
  params,
}: {
  clientName: string;
  scopes: string[];
  params: Params;
}) {
  const { configured, loading, user, signIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { redirectUrl } = await api.authorizeOAuth({
        body: {
          client_id: params.client_id ?? '',
          redirect_uri: params.redirect_uri ?? '',
          response_type: params.response_type ?? '',
          ...(params.scope && { scope: params.scope }),
          ...(params.state && { state: params.state }),
          ...(params.code_challenge && { code_challenge: params.code_challenge }),
          ...(params.code_challenge_method && {
            code_challenge_method: params.code_challenge_method,
          }),
          ...(params.resource && { resource: params.resource }),
          approve,
        },
      });
      window.location.assign(redirectUrl);
    } catch {
      setError('Could not complete the request. Start again from the app.');
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-6">
      <p className="text-sm">
        <b>{clientName}</b> wants to:
      </p>
      <ul className="list-disc pl-5 text-sm">
        {scopes.map((s) => (
          <li key={s}>{SCOPE_TEXT[s] ?? s}</li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        It cannot trade or move money. You can revoke access any time in Settings.
      </p>
      {error && <ErrorState message={error} />}
      {user ? (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
          >
            Allow
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="rounded-sm border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      ) : (
        <button
          onClick={signIn}
          disabled={!configured || loading}
          className="self-start rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50"
        >
          Sign in to continue
        </button>
      )}
    </div>
  );
}
