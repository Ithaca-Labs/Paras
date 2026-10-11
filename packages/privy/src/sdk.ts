import { PrivyClient } from '@privy-io/node';
import type { PrivyPort } from './port.js';

/**
 * Real Privy client. Not exercised in CI (no network); see the PRD "Privy delegation" finding for what
 * was checked by hand. `authorizationPrivateKey` is Paras's P-256 key (base64 PKCS8, no PEM header).
 */
export function createPrivyPort(p: {
  appId: string;
  appSecret: string;
  authorizationPrivateKey: string;
}): PrivyPort {
  const privy = new PrivyClient({ appId: p.appId, appSecret: p.appSecret });
  const authorization_context = { authorization_private_keys: [p.authorizationPrivateKey] };
  return {
    async verifyLogin({ accessToken, identityToken }) {
      const auth = privy.utils().auth();
      const claims = await auth.verifyAccessToken(accessToken);
      const user = await auth.verifyIdentityToken(identityToken);
      if (user.id !== claims.user_id) throw new Error('token user mismatch');
      const w = user.linked_accounts.find(
        (a) =>
          a.type === 'wallet' &&
          'connector_type' in a &&
          a.connector_type === 'embedded' &&
          a.chain_type === 'ethereum',
      );
      return {
        privyUserId: user.id,
        wallet: w && 'id' in w && w.id && 'address' in w ? { id: w.id, address: w.address } : null,
      };
    },
    async createPolicy(body) {
      const r = await privy.policies().create(body as never);
      return { id: r.id };
    },
    async walletSigners(walletId) {
      const w = await privy.wallets().get(walletId);
      return w.additional_signers.map((s) => s.signer_id);
    },
    async signTypedData(walletId, t) {
      const r = await privy
        .wallets()
        .ethereum()
        .signTypedData(walletId, {
          params: {
            typed_data: {
              domain: t.domain,
              types: t.types,
              primary_type: t.primaryType,
              message: t.message,
            },
          },
          authorization_context,
        } as never);
      return r.signature as `0x${string}`;
    },
    async sendTransaction(walletId, tx) {
      const r = await privy
        .wallets()
        .ethereum()
        .sendTransaction(walletId, {
          caip2: `eip155:${tx.chainId}`,
          params: { transaction: { to: tx.to, data: tx.data, value: '0x0' } },
          authorization_context,
        } as never);
      return { hash: r.hash };
    },
  };
}
