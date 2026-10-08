import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeUsers } from '../src/auth/users.js';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    oauth: { registerLimit: { max: 3, windowMs: 3600_000 }, maxUnusedClients: 5 },
  });
});
afterAll(() => t.close());

const register = (ip: string) =>
  t.app.inject({
    method: 'POST',
    url: '/oauth/register',
    remoteAddress: ip,
    payload: { redirect_uris: ['http://127.0.0.1:8123/cb'] },
  });

describe('dynamic client registration limits', () => {
  it('rate-limits per IP', async () => {
    for (let i = 0; i < 3; i++) expect((await register('10.0.0.1')).statusCode).toBe(201);
    const over = await register('10.0.0.1');
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe('temporarily_unavailable');
    expect((await register('10.0.0.2')).statusCode).toBe(201); // other IPs unaffected
  });

  it('caps clients nobody has authorized', async () => {
    // 4 unused so far; one more fits, then the cap bites.
    expect((await register('10.0.0.3')).statusCode).toBe(201);
    expect((await register('10.0.0.3')).statusCode).toBe(429);
  });
});

describe('mergeUsers', () => {
  it('repoints OAuth grants and codes to the survivor', async () => {
    const [a, b] = await t.db
      .insert(schema.users)
      .values([{ createdAt: new Date(Date.now() - 1000) }, {}])
      .returning();
    const [client] = await t.db
      .insert(schema.oauthClients)
      .values({ id: 'cl_merge', name: 'Merge', redirectUris: ['http://127.0.0.1/cb'] })
      .returning();
    await t.db
      .insert(schema.oauthGrants)
      .values({ clientId: client!.id, userId: b!.id, scopes: ['markets:read'] });
    await t.db.insert(schema.oauthCodes).values({
      codeHash: 'h',
      clientId: client!.id,
      userId: b!.id,
      scopes: ['markets:read'],
      redirectUri: 'http://127.0.0.1/cb',
      codeChallenge: 'c',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const survivor = await t.db.transaction((tx) => mergeUsers(tx, a!.id, b!.id));
    expect(survivor).toBe(a!.id); // older wins

    const grants = await t.db.select().from(schema.oauthGrants);
    const codes = await t.db
      .select()
      .from(schema.oauthCodes)
      .where(eq(schema.oauthCodes.codeHash, 'h'));
    expect(grants.map((g) => g.userId)).toEqual([a!.id]);
    expect(codes.map((c) => c.userId)).toEqual([a!.id]);
  });
});
