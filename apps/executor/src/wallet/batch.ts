import { concatHex, encodeAbiParameters, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

/** Polymarket DepositWallet EIP-712 `Batch`, executed only via the relayer/factory. */
export interface Batch {
  wallet: Address;
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
  calls: Call[];
}

const types = {
  Call: [
    { name: 'target', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  Batch: [
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'calls', type: 'Call[]' },
  ],
} as const;

export function batchTypedData(batch: Batch, chainId: number) {
  return {
    domain: {
      name: 'DepositWallet',
      version: '1',
      chainId,
      verifyingContract: batch.wallet,
    },
    types,
    primaryType: 'Batch' as const,
    message: batch,
  };
}

/** Marker the wallet uses to recognise a session-signed payload (ERC-6492-style suffix). */
const SESSION_MAGIC: Hex = `0x${'64926492'.repeat(8)}`;

/** Wrap a session signer's ECDSA signature the way the DepositWallet expects (see spikes/17). */
export function wrapSessionSignature(signer: Address, innerSignature: Hex): Hex {
  const body = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
    [signer, 0n, innerSignature],
  );
  return concatHex([body, SESSION_MAGIC]);
}

/** Sign a batch with a session private key. Call sites must run the policy check first. */
export async function signBatchAsSession(
  privateKey: Hex,
  batch: Batch,
  chainId: number,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const inner = await account.signTypedData(batchTypedData(batch, chainId));
  return wrapSessionSignature(account.address, inner);
}
