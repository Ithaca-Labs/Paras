import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts session private keys at rest. `aad` binds a ciphertext to its record (the key's address),
 * so a ciphertext can't be swapped between rows.
 */
export interface KeyCipher {
  encrypt(plaintext: string, aad: string): Promise<string>;
  decrypt(ciphertext: string, aad: string): Promise<string>;
}

/** AES-256-GCM with an env master key (testnet / dev). Format: `v1.<iv>.<tag>.<data>` (base64url). */
export class EnvKeyCipher implements KeyCipher {
  private readonly key: Buffer;

  constructor(masterKeyHex: string) {
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(masterKeyHex))
      throw new Error('EXECUTOR_MASTER_KEY must be 32 bytes of hex');
    this.key = Buffer.from(masterKeyHex.replace(/^0x/, ''), 'hex');
  }

  async encrypt(plaintext: string, aad: string): Promise<string> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(aad));
    const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
    return ['v1', iv, c.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  async decrypt(ciphertext: string, aad: string): Promise<string> {
    const [v, iv, tag, data] = ciphertext.split('.');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('unsupported ciphertext');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }
}

/** KMS-backed cipher. Stub: required before mainnet (launch gate, PRD > Key custody). */
export class KmsKeyCipher implements KeyCipher {
  async encrypt(): Promise<string> {
    throw new Error('KMS key cipher not implemented: required before mainnet');
  }
  async decrypt(): Promise<string> {
    throw new Error('KMS key cipher not implemented: required before mainnet');
  }
}

export interface KeyCipherConfig {
  EXECUTOR_NETWORK: 'testnet' | 'mainnet';
  EXECUTOR_KEY_BACKEND: 'env' | 'kms';
  EXECUTOR_MASTER_KEY?: string | undefined;
}

/** Mainnet refuses the env master key: it must use KMS. */
export function createKeyCipher(cfg: KeyCipherConfig): KeyCipher {
  if (cfg.EXECUTOR_KEY_BACKEND === 'kms') return new KmsKeyCipher();
  if (cfg.EXECUTOR_NETWORK === 'mainnet')
    throw new Error('mainnet requires EXECUTOR_KEY_BACKEND=kms (env master key is testnet-only)');
  if (!cfg.EXECUTOR_MASTER_KEY) throw new Error('EXECUTOR_MASTER_KEY is required');
  return new EnvKeyCipher(cfg.EXECUTOR_MASTER_KEY);
}
