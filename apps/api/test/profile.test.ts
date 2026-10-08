import { schema } from '@paras/db';
import { cosine, buildTaxonomyIndex } from '@paras/domain';
import { createFakeEmbedder } from '@paras/embeddings';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_AUTH_DOMAIN, createTestApp, type TestApp } from './harness.js';

const embedder = createFakeEmbedder();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ embedder, auth: { maxCodesPerIp: 10_000 } });
});
afterAll(() => t.close());

// Test-only loose JSON; bodies are asserted field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  const setCookies = [res.headers['set-cookie'] ?? []].flat() as string[];
  const named = (n: string) => setCookies.find((c) => c.startsWith(`${n}=`));
  return { status: res.statusCode, json: res.json() as Json, setCookies, named };
}

const pair = (c: string | undefined) => c?.split(';')[0];

let n = 0;
async function signIn(cookie?: string, anonCookie?: string) {
  const email = `p${++n}-${Date.now()}@example.com`;
  await call('POST', '/v1/auth/email/request', { body: { email } });
  const res = await call('POST', '/v1/auth/email/verify', {
    body: { email, code: t.mailer.lastCode(email), session: 'cookie' },
    cookie: [cookie, anonCookie].filter(Boolean).join('; ') || undefined,
  });
  expect(res.status).toBe(200);
  return { res, session: pair(res.named('paras_session'))! };
}

const FED = 'fed-rates';
const BTC = 'bitcoin';
const CRYPTO = 'crypto';
const LAKERS = 'lakers';

describe('Interest Profile (signed out)', () => {
  it('creates an anonymous profile, restores it by cookie or header, edits by merge', async () => {
    const empty = await call('GET', '/v1/profile');
    expect(empty.json).toMatchObject({ status: 'none', anonymous: true, categories: [] });

    const created = await call('PATCH', '/v1/profile', {
      body: {
        categories: [CRYPTO],
        topics: [BTC],
        freeText: ['I follow F1 and AI startups'],
        experience: 'beginner',
        riskAppetite: 'conservative',
        stakeSize: 'small',
        horizon: 'week',
      },
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({
      status: 'completed',
      anonymous: true,
      topics: [BTC],
      experience: 'beginner',
      horizon: 'week',
    });
    const token = created.json.anonToken as string;
    expect(token).toBeTruthy();
    const cookie = pair(created.named('paras_anon'))!;
    expect(created.named('paras_anon')).toMatch(/HttpOnly/);

    const byCookie = await call('GET', '/v1/profile', { cookie });
    expect(byCookie.json).toMatchObject({ status: 'completed', topics: [BTC], anonToken: null });
    const byHeader = await call('GET', '/v1/profile', { headers: { 'x-paras-anon': token } });
    expect(byHeader.json.topics).toEqual([BTC]);

    const edited = await call('PATCH', '/v1/profile', {
      cookie,
      body: { entities: [LAKERS], horizon: 'long', riskAppetite: null },
    });
    expect(edited.json).toMatchObject({
      topics: [BTC],
      entities: [LAKERS],
      horizon: 'long',
      experience: 'beginner',
      riskAppetite: null,
      anonToken: null,
    });
    expect(edited.named('paras_anon')).toBeUndefined();
  });

  it('rejects unknown ids and ids of the wrong kind', async () => {
    const bad = await call('PATCH', '/v1/profile', { body: { entities: ['nope'] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('validation_error');
    const wrongKind = await call('PATCH', '/v1/profile', { body: { categories: [BTC] } });
    expect(wrongKind.status).toBe(400);
    expect((await call('PATCH', '/v1/profile', { body: { experience: 'wizard' } })).status).toBe(
      400,
    );
  });

  it('skip works, is idempotent, never clobbers a completed profile; reset clears', async () => {
    const skipped = await call('POST', '/v1/profile/skip');
    expect(skipped.json).toMatchObject({ status: 'skipped', anonymous: true });
    const cookie = pair(skipped.named('paras_anon'))!;
    expect((await call('POST', '/v1/profile/skip', { cookie })).json.status).toBe('skipped');

    await call('PATCH', '/v1/profile', { cookie, body: { topics: [BTC] } });
    expect((await call('POST', '/v1/profile/skip', { cookie })).json.status).toBe('completed');

    expect((await call('DELETE', '/v1/profile', { cookie })).json).toEqual({ ok: true });
    expect((await call('GET', '/v1/profile', { cookie })).json.status).toBe('none');
  });

  it('stores a profile vector near picked interests (for Feed ranking)', async () => {
    const created = await call('PATCH', '/v1/profile', {
      body: { topics: [BTC], freeText: ['bitcoin price'] },
    });
    const [row] = await t.db
      .select()
      .from(schema.interestProfiles)
      .where(eq(schema.interestProfiles.status, 'completed'))
      .limit(100)
      .then((rows) => rows.filter((r) => r.topics.includes(BTC) && r.freeText.length));
    expect(created.status).toBe(200);
    const index = await buildTaxonomyIndex(embedder);
    expect(row!.embedding).toHaveLength(384);
    expect(cosine(row!.embedding!, index.vectors.get(BTC)!)).toBeGreaterThan(
      cosine(row!.embedding!, index.vectors.get(FED)!) + 0.3,
    );
  });
});

describe('onboarding content', () => {
  it('lists enum options', async () => {
    const r = await call('GET', '/v1/onboarding/options');
    expect(r.json.experience).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(r.json.horizon).toContain('week');
  });

  it('maps free text to taxonomy nodes', async () => {
    const r = await call('POST', '/v1/onboarding/interpret', { body: { text: 'bitcoin price' } });
    expect(r.json.matches[0]).toMatchObject({ id: BTC, kind: 'topic' });
  });

  it('explainer adapts to experience level (query, then profile, then beginner)', async () => {
    const ids = async (qs = '', cookie?: string) =>
      (await call('GET', `/v1/onboarding/explainer${qs}`, { cookie })).json;
    const beginner = await ids();
    expect(beginner.experience).toBe('beginner');
    expect(beginner.sections.map((s: Json) => s.id)).toContain('price');
    const advanced = await ids('?experience=advanced');
    expect(advanced.sections.map((s: Json) => s.id)).not.toContain('price');
    expect(advanced.sections.length).toBeLessThan(beginner.sections.length);

    const created = await call('PATCH', '/v1/profile', { body: { experience: 'advanced' } });
    const viaProfile = await ids('', pair(created.named('paras_anon')));
    expect(viaProfile).toEqual(advanced);
  });
});

describe('sign-in merge', () => {
  it('anonymous profile moves to the User on sign-in and the anon cookie is cleared', async () => {
    const anon = await call('PATCH', '/v1/profile', { body: { topics: [BTC, FED] } });
    const anonCookie = pair(anon.named('paras_anon'))!;
    const { res, session } = await signIn(undefined, anonCookie);
    expect(res.named('paras_anon')).toMatch(/Max-Age=0/);

    const mine = await call('GET', '/v1/profile', { cookie: session });
    expect(mine.json).toMatchObject({ status: 'completed', anonymous: false, topics: [BTC, FED] });
    expect((await call('GET', '/v1/profile', { cookie: anonCookie })).json.status).toBe('none');
  });

  it('keeps an existing completed profile over the anonymous one; skipped loses to completed', async () => {
    const first = await signIn();
    await call('PATCH', '/v1/profile', { cookie: first.session, body: { topics: [BTC] } });
    const anon = await call('PATCH', '/v1/profile', { body: { topics: [FED] } });
    const anonCookie = pair(anon.named('paras_anon'))!;
    // Linking while signed in: user's completed profile wins.
    const email = `link${++n}-${Date.now()}@example.com`;
    await call('POST', '/v1/auth/email/request', { body: { email } });
    await call('POST', '/v1/auth/email/verify', {
      body: { email, code: t.mailer.lastCode(email), session: 'cookie' },
      cookie: `${first.session}; ${anonCookie}`,
    });
    const kept = await call('GET', '/v1/profile', { cookie: first.session });
    expect(kept.json).toMatchObject({ topics: [BTC] });

    const skipper = await signIn();
    await call('POST', '/v1/profile/skip', { cookie: skipper.session });
    const anon2 = await call('PATCH', '/v1/profile', { body: { topics: [FED] } });
    const email2 = `link${++n}-${Date.now()}@example.com`;
    await call('POST', '/v1/auth/email/request', { body: { email: email2 } });
    await call('POST', '/v1/auth/email/verify', {
      body: { email: email2, code: t.mailer.lastCode(email2), session: 'cookie' },
      cookie: `${skipper.session}; ${pair(anon2.named('paras_anon'))}`,
    });
    expect((await call('GET', '/v1/profile', { cookie: skipper.session })).json).toMatchObject({
      status: 'completed',
      topics: [FED],
    });
  });

  it('merging two Users keeps one profile (completed beats skipped)', async () => {
    const a = await signIn(); // older, survives
    await call('POST', '/v1/profile/skip', { cookie: a.session });
    const wallet = privateKeyToAccount(generatePrivateKey());
    const nonce = (await call('GET', '/v1/auth/siwe/nonce')).json.nonce;
    const message = createSiweMessage({
      address: wallet.address,
      chainId: 10143,
      domain: TEST_AUTH_DOMAIN,
      nonce,
      uri: `https://${TEST_AUTH_DOMAIN}`,
      version: '1',
    });
    const body = { message, signature: await wallet.signMessage({ message }), session: 'cookie' };
    const b = await call('POST', '/v1/auth/siwe/verify', { body });
    const bSession = pair(b.named('paras_session'))!;
    await call('PATCH', '/v1/profile', { cookie: bSession, body: { topics: [BTC] } });

    // A (signed in) proves B's wallet: B is absorbed into A.
    const nonce2 = (await call('GET', '/v1/auth/siwe/nonce')).json.nonce;
    const message2 = createSiweMessage({
      address: wallet.address,
      chainId: 10143,
      domain: TEST_AUTH_DOMAIN,
      nonce: nonce2,
      uri: `https://${TEST_AUTH_DOMAIN}`,
      version: '1',
    });
    const merged = await call('POST', '/v1/auth/siwe/verify', {
      body: {
        message: message2,
        signature: await wallet.signMessage({ message: message2 }),
        session: 'cookie',
      },
      cookie: a.session,
    });
    expect(merged.json.merged).toBe(true);
    expect((await call('GET', '/v1/profile', { cookie: a.session })).json).toMatchObject({
      status: 'completed',
      topics: [BTC],
    });
  });
});
