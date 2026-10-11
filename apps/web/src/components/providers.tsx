'use client';

import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import type { Me } from '@paras/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { endSession, exchangePrivyToken, fetchMe } from '@/lib/session';

const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonVision', url: 'https://testnet.monadvision.com' } },
  testnet: true,
};

export interface Session {
  /** Privy configured (NEXT_PUBLIC_PRIVY_APP_ID set). Unset = sign-in disabled. */
  configured: boolean;
  loading: boolean;
  user: Me | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session>({
  configured: false,
  loading: false,
  user: null,
  signIn: () => undefined,
  signOut: async () => undefined,
});

export const useSession = () => useContext(SessionContext);

/** Privy sign-in -> API session. Must sit inside PrivyProvider. */
function PrivySession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    (async () => {
      if (authenticated) {
        const token = await getAccessToken();
        if (token) await exchangePrivyToken(token).catch(() => undefined);
      }
      const me = await fetchMe();
      if (live) {
        setUser(me);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [ready, authenticated, getAccessToken]);

  const signOut = useCallback(async () => {
    await endSession();
    await logout();
    setUser(null);
  }, [logout]);

  const value = useMemo<Session>(
    () => ({ configured: true, loading: loading || !ready, user, signIn: login, signOut }),
    [loading, ready, user, login, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  if (!appId) return children; // default context: signed out, sign-in disabled
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'wallet', 'google'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
      }}
    >
      <PrivySession>{children}</PrivySession>
    </PrivyProvider>
  );
}
