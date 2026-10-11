'use client';

import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, type Address } from 'viem';
import { chain } from './vault-chain';

/**
 * The User's Privy wallet (embedded preferred) as a viem wallet client on Monad testnet.
 * Only call inside components rendered when Privy is configured and the User is signed in.
 */
export function useVaultWallet() {
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
  const address = wallet?.address.toLowerCase() as Address | undefined;
  const client = async () => {
    if (!wallet) throw new Error('No wallet connected');
    await wallet.switchChain(chain.id);
    return createWalletClient({
      account: wallet.address as Address,
      chain,
      transport: custom(await wallet.getEthereumProvider()),
    });
  };
  return { address, client };
}
