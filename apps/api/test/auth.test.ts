import { schema } from '@paras/db';
import type { AuthResult, Me } from '@paras/shared';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_AUTH_DOMAIN, createTestApp, type TestApp } from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ auth: { maxCodesPerIp: 10_000 } });
});
afterAll(() => t.close());

// Test-only loose JSON; bodies are asserted field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; cookie?: string; bearer?: string } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  const setCookie = [res.headers['set-cookie'] ?? []].flat()[0] as string | undefined;
  return {
    status: res.statusCode,
    json: res.json() as Json,
    setCookie,
    /** `name=value` for replaying as a Cookie header. */
    cookie: setCookie?.split(';')[0],
  };
}

const newWallet = () => privateKeyToAccount(generatePrivateKey());
type Wallet = ReturnType<typeof newWallet>;

async function siweBody(
  wallet: Wallet,
  over: {
    domain?: string;
    chainId?: number;
    returnTo?: string;
    session?: 'cookie' | 'bearer';
  } = {},
  tamper?: (message: string) => string,
) {
  const n = await call(
    'GET',
    `/v1/auth/siwe/nonce${over.returnTo ? `?returnTo=${encodeURIComponent(over.returnTo)}` : ''}`,
  );
  let message = createSiweMessage({
    address: wallet.address,
    chainId: over.chainId ?? 10143,
    domain: over.domain ?? TEST_AUTH_DOMAIN,
    nonce: n.json.nonce,
    uri: `https://${TEST_AUTH_DOMAIN}`,
    version: '1',
    statement: 'Sign in to Paras',
  });
  const signature = await wallet.signMessage({ message });
  if (tamper) message = tamper(message);
  return { message, signature, session: over.session ?? 'cookie' };
}

const siweLogin = async (wallet: Wallet, opts: { cookie?: string; bearer?: string } = {}) =>
  call('POST', '/v1/auth/siwe/verify', { body: await siweBody(wallet), ...opts });

let emailCounter = 0;
const newEmail = () => `user${++emailCounter}-${Date.now()}@example.com`;

async function emailLogin(
  email: string,
  opts: { cookie?: string; bearer?: string; session?: 'cookie' | 'bearer'; returnTo?: string } = {},
) {
  const r = await call('POST', '/v1/auth/email/request', {
    body: { email, returnTo: opts.returnTo },
  });
  expect(r.status).toBe(200);
  const code = t.mailer.lastCode(email.trim().toLowerCase());
  expect(code).toMatch(/^\d{6}$/);
  return call('POST', '/v1/auth/email/verify', {
    body: { email, code, session: opts.session ?? 'cookie' },
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
    ...(opts.bearer ? { bearer: opts.bearer } : {}),
  });
}

describe('SIWE', () => {
  it('logs in, creates a httpOnly cookie session, serves /v1/me, logs out', async () => {
    const wallet = newWallet();
    const res = await siweLogin(wallet);
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    expect(res.json.token).toBeNull();
    expect(res.json.linked).toBe(false);

    const me = await call('GET', '/v1/me', { cookie: res.cookie! });
    expect(me.status).toBe(200);
    expect(me.json.wallets).toEqual([{ address: wallet.address.toLowerCase(), chainId: 10143 }]);
    expect(me.json.emails).toEqual([]);

    const out = await call('POST', '/v1/auth/logout', { cookie: res.cookie! });
    expect(out.status).toBe(200);
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call('GET', '/v1/me', { cookie: res.cookie! })).status).toBe(401);
  });

  it('same wallet signs in again to the same User', async () => {
    const wallet = newWallet();
    const a = await siweLogin(wallet);
    const b = await siweLogin(wallet);
    expect(b.json.user.id).toBe(a.json.user.id);
  });

  it('bearer mode returns a token and sets no cookie', async () => {
    const wallet = newWallet();
    const res = await call('POST', '/v1/auth/siwe/verify', {
      body: await siweBody(wallet, { session: 'bearer' }),
    });
    expect(res.setCookie).toBeUndefined();
    expect(res.json.token).toEqual(expect.any(String));
    const me = await call('GET', '/v1/me', { bearer: res.json.token });
    expect(me.json.id).toBe(res.json.user.id);
  });

  it('rejects a replayed nonce', async () => {
    const body = await siweBody(newWallet());
    expect((await call('POST', '/v1/auth/siwe/verify', { body })).status).toBe(200);
    const again = await call('POST', '/v1/auth/siwe/verify', { body });
    expect(again.status).toBe(401);
    expect(again.json.error.code).toBe('invalid_siwe');
  });

  it('rejects wrong domain, unsupported chain, bad signature, unknown nonce', async () => {
    const wallet = newWallet();
    const cases = [
      await siweBody(wallet, { domain: 'evil.example' }),
      await siweBody(wallet, { chainId: 1 }),
      { ...(await siweBody(wallet)), signature: (await siweBody(newWallet())).signature },
      await siweBody(wallet, {}, (m) => m.replace(/Nonce: \w+/, 'Nonce: deadbeefdeadbeef')),
      { message: 'garbage', signature: '0x00', session: 'cookie' },
    ];
    for (const body of cases) {
      const res = await call('POST', '/v1/auth/siwe/verify', { body });
      expect(res.status).toBe(401);
    }
  });

  it('rejects an expired nonce', async () => {
    const body = await siweBody(newWallet());
    t.clock.advance(11 * 60_000);
    expect((await call('POST', '/v1/auth/siwe/verify', { body })).status).toBe(401);
    t.clock.advance(-11 * 60_000);
  });

  it('passes returnTo through nonce -> verify, dropping external URLs', async () => {
    const ok = await call('POST', '/v1/auth/siwe/verify', {
      body: await siweBody(newWallet(), { returnTo: '/m/abc?amount=20' }),
    });
    expect(ok.json.returnTo).toBe('/m/abc?amount=20');
    const bad = await call('POST', '/v1/auth/siwe/verify', {
      body: await siweBody(newWallet(), { returnTo: 'https://evil.example' }),
    });
    expect(bad.json.returnTo).toBeNull();
  });
});

describe('email OTP', () => {
  it('logs in with an emailed code and normalizes the address', async () => {
    const email = newEmail();
    const res = await emailLogin(email.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/HttpOnly/);
    const me = await call('GET', '/v1/me', { cookie: res.cookie! });
    expect(me.json.emails).toEqual([email]);
  });

  it('never stores the plain code', async () => {
    const email = newEmail();
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const code = t.mailer.lastCode(email)!;
    const [row] = await t.db
      .select()
      .from(schema.emailCodes)
      .where(eq(schema.emailCodes.email, email));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toHaveLength(64);
  });

  it('is a single-use code', async () => {
    const email = newEmail();
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const code = t.mailer.lastCode(email);
    const first = await call('POST', '/v1/auth/email/verify', { body: { email, code } });
    expect(first.status).toBe(200);
    const second = await call('POST', '/v1/auth/email/verify', { body: { email, code } });
    expect(second.status).toBe(400);
  });

  it('wrong code fails; attempts are capped even for the right code afterwards', async () => {
    const email = newEmail();
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const code = t.mailer.lastCode(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/v1/auth/email/verify', { body: { email, code: wrong } });
      expect(r.status).toBe(400);
    }
    const locked = await call('POST', '/v1/auth/email/verify', { body: { email, code } });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('too_many_attempts');
  });

  it('expires after the TTL', async () => {
    const email = newEmail();
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const code = t.mailer.lastCode(email);
    t.clock.advance(11 * 60_000);
    const r = await call('POST', '/v1/auth/email/verify', { body: { email, code } });
    expect(r.status).toBe(400);
    t.clock.advance(-11 * 60_000);
  });

  it('a newer code invalidates the older one', async () => {
    const email = newEmail();
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const old = t.mailer.lastCode(email)!;
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const fresh = t.mailer.lastCode(email)!;
    if (old !== fresh) {
      expect(
        (await call('POST', '/v1/auth/email/verify', { body: { email, code: old } })).status,
      ).toBe(400);
    }
    expect(
      (await call('POST', '/v1/auth/email/verify', { body: { email, code: fresh } })).status,
    ).toBe(200);
  });

  it('rate limits code requests per email', async () => {
    const email = newEmail();
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/v1/auth/email/request', { body: { email } })).status).toBe(200);
    }
    const r = await call('POST', '/v1/auth/email/request', { body: { email } });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('rate_limited');
    expect(t.mailer.outbox.filter((m) => m.to === email)).toHaveLength(3);
  });

  it('rate limits code requests per IP', async () => {
    const small = await createTestApp({ auth: { maxCodesPerIp: 2 } });
    try {
      const req = (email: string) =>
        small.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
      expect((await req('a@example.com')).statusCode).toBe(200);
      expect((await req('b@example.com')).statusCode).toBe(200);
      expect((await req('c@example.com')).statusCode).toBe(429);
    } finally {
      await small.close();
    }
  });

  it('rejects malformed emails', async () => {
    const r = await call('POST', '/v1/auth/email/request', { body: { email: 'nope' } });
    expect(r.status).toBe(400);
  });

  it('passes returnTo from request to verify, sanitized', async () => {
    const a = await emailLogin(newEmail(), { returnTo: '/m/abc?o=yes' });
    expect(a.json.returnTo).toBe('/m/abc?o=yes');
    const b = await emailLogin(newEmail(), { returnTo: '//evil.example' });
    expect(b.json.returnTo).toBeNull();
  });

  it('bearer mode works end to end', async () => {
    const res = await emailLogin(newEmail(), { session: 'bearer' });
    expect(res.setCookie).toBeUndefined();
    expect((await call('GET', '/v1/me', { bearer: res.json.token })).status).toBe(200);
  });
});

describe('auth guard', () => {
  it('401s without credentials, with garbage, and after expiry', async () => {
    const none = await call('GET', '/v1/me');
    expect(none.status).toBe(401);
    expect(none.json.error.code).toBe('unauthorized');
    expect((await call('GET', '/v1/me', { bearer: 'nope' })).status).toBe(401);
    expect((await call('GET', '/v1/me', { cookie: 'paras_session=nope' })).status).toBe(401);

    const res = await emailLogin(newEmail());
    t.clock.advance(31 * 24 * 3600_000);
    expect((await call('GET', '/v1/me', { cookie: res.cookie! })).status).toBe(401);
    t.clock.advance(-31 * 24 * 3600_000);
  });

  it('typed client forwards a bearer token', async () => {
    const res = await emailLogin(newEmail(), { session: 'bearer' });
    const { createApiClient } = await import('@paras/shared');
    const mk = (token?: string) =>
      createApiClient({
        baseUrl: 'http://api.test',
        fetch: (async (input: string | URL, init?: RequestInit) => {
          const r = await t.app.inject({
            method: (init?.method ?? 'GET') as 'GET',
            url: new URL(String(input)).pathname,
            headers: init?.headers as Record<string, string>,
          });
          return new Response(r.body, { status: r.statusCode });
        }) as typeof fetch,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      });
    const me: Me = await mk(res.json.token).getMe();
    expect(me.id).toBe(res.json.user.id);
  });
});

describe('account linking', () => {
  it('profile persists across devices: same email on a second device is the same User', async () => {
    const email = newEmail();
    const deviceA = await emailLogin(email);
    const deviceB = await emailLogin(email);
    expect(deviceB.json.user.id).toBe(deviceA.json.user.id);
    expect(deviceB.cookie).not.toBe(deviceA.cookie);
  });

  it('signed in with email, then SIWE: wallet attaches to the same User', async () => {
    const email = newEmail();
    const wallet = newWallet();
    const a = await emailLogin(email);
    const b = await siweLogin(wallet, { cookie: a.cookie! });
    expect(b.status).toBe(200);
    expect(b.json.linked).toBe(true);
    expect(b.json.merged).toBe(false);
    expect(b.json.user.id).toBe(a.json.user.id);
    expect(b.setCookie).toBeUndefined(); // session kept
    expect(b.json.user.emails).toEqual([email]);
    expect(b.json.user.wallets).toHaveLength(1);

    // Signing in later with only the wallet reaches the same User, emails included.
    const later = await siweLogin(wallet);
    expect(later.json.user.id).toBe(a.json.user.id);
    expect(later.json.user.emails).toEqual([email]);
  });

  it('signed in with wallet, then email code: email attaches', async () => {
    const wallet = newWallet();
    const email = newEmail();
    const a = await siweLogin(wallet);
    const b = await emailLogin(email, { cookie: a.cookie! });
    expect(b.json.linked).toBe(true);
    expect(b.json.user.id).toBe(a.json.user.id);
    const viaEmail = await emailLogin(email);
    expect(viaEmail.json.user.id).toBe(a.json.user.id);
    expect(viaEmail.json.user.wallets).toHaveLength(1);
  });

  it('linking is idempotent for an identity the User already has', async () => {
    const wallet = newWallet();
    const a = await siweLogin(wallet);
    const again = await siweLogin(wallet, { cookie: a.cookie! });
    expect(again.json.linked).toBe(false);
    expect(again.json.merged).toBe(false);
    expect(again.json.user.wallets).toHaveLength(1);
  });

  it('merges two existing Users: older survives, everything moves, sessions follow', async () => {
    const wallet = newWallet();
    const email = newEmail();
    const walletUser = await siweLogin(wallet); // older
    const emailUser = await emailLogin(email); // younger
    expect(walletUser.json.user.id).not.toBe(emailUser.json.user.id);
    const extraWallet = newWallet();
    await siweLogin(extraWallet, { cookie: emailUser.cookie! }); // younger now has email + wallet

    // Younger (email) user proves the older user's wallet.
    const merged = await siweLogin(wallet, { cookie: emailUser.cookie! });
    expect(merged.status).toBe(200);
    expect(merged.json.merged).toBe(true);
    expect(merged.json.user.id).toBe(walletUser.json.user.id);
    expect(merged.json.user.emails).toEqual([email]);
    expect(merged.json.user.wallets.map((w: Json) => w.address).sort()).toEqual(
      [wallet.address, extraWallet.address].map((a) => a.toLowerCase()).sort(),
    );

    // Both prior sessions now resolve to the survivor.
    expect((await call('GET', '/v1/me', { cookie: emailUser.cookie! })).json.id).toBe(
      walletUser.json.user.id,
    );
    expect((await call('GET', '/v1/me', { cookie: walletUser.cookie! })).json.id).toBe(
      walletUser.json.user.id,
    );
    // Fresh logins via either identity land on the survivor.
    expect((await emailLogin(email)).json.user.id).toBe(walletUser.json.user.id);

    // The absorbed User is a tombstone, not deleted.
    const [absorbed] = await t.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, emailUser.json.user.id));
    expect(absorbed!.mergedIntoId).toBe(walletUser.json.user.id);
  });

  it('merge direction does not depend on which side is signed in', async () => {
    const wallet = newWallet();
    const email = newEmail();
    const older = await siweLogin(wallet);
    const younger = await emailLogin(email);
    // Older user signed in, proves the younger user's email.
    const res = await emailLogin(email, { cookie: older.cookie! });
    expect(res.json.merged).toBe(true);
    expect(res.json.user.id).toBe(older.json.user.id);
    expect(younger.json.user.id).not.toBe(older.json.user.id);
  });
});

describe('typed result shape', () => {
  it('AuthResult fields', async () => {
    const res = await emailLogin(newEmail());
    const r = res.json as AuthResult;
    expect(Object.keys(r).sort()).toEqual(
      ['expiresAt', 'linked', 'merged', 'returnTo', 'token', 'user'].sort(),
    );
  });
});
