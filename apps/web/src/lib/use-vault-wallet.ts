'use client';

import { useSignTypedData, useWallets } from '@privy-io/react-auth';
import {
  createWalletClient,
  custom,
  getTypesForEIP712Domain,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { chain } from './vault-chain';

/**
 * The User's Privy wallet (embedded preferred) as a viem wallet client on Monad testnet.
 * Only call inside components rendered when Privy is configured and the User is signed in.
 */
type TypedPayload = {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export function useVaultWallet() {
  const { wallets } = useWallets();
  const { signTypedData: privySign } = useSignTypedData();
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
  /**
   * Embedded wallet: signs without Privy's sign modal. That modal crashes when a tx prompt opens
   * right after it (#123); the following tx is still confirmed in Privy's tx modal.
   */
  const signTypedData = async (typed: TypedPayload): Promise<Hex> => {
    if (wallet?.walletClientType !== 'privy') return (await client()).signTypedData(typed as never);
    await wallet.switchChain(chain.id);
    // Privy expects eth_signTypedData_v4 JSON: explicit EIP712Domain type, no bigints.
    const types = { EIP712Domain: getTypesForEIP712Domain(typed), ...typed.types };
    const json = JSON.parse(
      JSON.stringify({ ...typed, types }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    const { signature } = await privySign(json, {
      address: wallet.address,
      uiOptions: { showWalletUIs: false },
    });
    return signature as Hex;
  };
  return { address, client, signTypedData };
}
