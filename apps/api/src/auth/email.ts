import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeEmail, sanitizeReturnTo } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { HttpError } from '../errors.js';
import type { AuthDeps } from './types.js';

const hashCode = (secret: string, email: string, code: string) =>
  createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');

export async function requestEmailCode(
  db: Database,
  deps: AuthDeps,
  input: { email: string; returnTo?: string | undefined; ip: string | undefined },
) {
  const email = normalizeEmail(input.email);
  if (!email) throw new HttpError(400, 'invalid_email', 'Invalid email address');
  const { config, now } = deps;
  const t = now();

  const [perEmail] = await db
    .select({ n: count() })
    .from(schema.emailCodes)
    .where(
      and(
        eq(schema.emailCodes.email, email),
        gt(schema.emailCodes.createdAt, new Date(t.getTime() - config.codeTtlMs)),
      ),
    );
  if ((perEmail?.n ?? 0) >= config.maxCodesPerEmail) {
    throw new HttpError(429, 'rate_limited', 'Too many codes requested; try again later');
  }
  if (input.ip) {
    const [perIp] = await db
      .select({ n: count() })
      .from(schema.emailCodes)
      .where(
        and(
          eq(schema.emailCodes.requestIp, input.ip),
          gt(schema.emailCodes.createdAt, new Date(t.getTime() - 3600_000)),
        ),
      );
    if ((perIp?.n ?? 0) >= config.maxCodesPerIp) {
      throw new HttpError(429, 'rate_limited', 'Too many codes requested; try again later');
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // Only the newest code is valid.
  await db
    .update(schema.emailCodes)
    .set({ consumedAt: t })
    .where(and(eq(schema.emailCodes.email, email), isNull(schema.emailCodes.consumedAt)));
  await db.insert(schema.emailCodes).values({
    email,
    codeHash: hashCode(config.secret, email, code),
    returnTo: sanitizeReturnTo(input.returnTo),
    requestIp: input.ip ?? null,
    createdAt: t,
    expiresAt: new Date(t.getTime() + config.codeTtlMs),
  });
  await deps.mailer.send({
    to: email,
    subject: 'Your Paras sign-in code',
    text: `Your Paras sign-in code is ${code}. It expires in ${Math.round(config.codeTtlMs / 60_000)} minutes. If you did not request it, ignore this email.`,
  });
}

/** Consumes the code on success. Returns the normalized email and the `returnTo` stored at request time. */
export async function consumeEmailCode(
  db: Database,
  deps: AuthDeps,
  input: { email: string; code: string },
): Promise<{ email: string; returnTo: string | null }> {
  const email = normalizeEmail(input.email);
  const bad = () => new HttpError(400, 'invalid_code', 'Invalid or expired code');
  if (!email) throw bad();
  const { config, now } = deps;
  const t = now();

  const [row] = await db
    .select()
    .from(schema.emailCodes)
    .where(
      and(
        eq(schema.emailCodes.email, email),
        isNull(schema.emailCodes.consumedAt),
        gt(schema.emailCodes.expiresAt, t),
      ),
    )
    .orderBy(desc(schema.emailCodes.createdAt))
    .limit(1);
  if (!row) throw bad();

  // Count the attempt atomically before comparing, so parallel guesses can't exceed the cap.
  const [bumped] = await db
    .update(schema.emailCodes)
    .set({ attempts: sql`${schema.emailCodes.attempts} + 1` })
    .where(
      and(
        eq(schema.emailCodes.id, row.id),
        isNull(schema.emailCodes.consumedAt),
        sql`${schema.emailCodes.attempts} < ${config.maxCodeAttempts}`,
      ),
    )
    .returning({ id: schema.emailCodes.id });
  if (!bumped)
    throw new HttpError(429, 'too_many_attempts', 'Too many attempts; request a new code');

  const given = Buffer.from(hashCode(config.secret, email, input.code.trim()));
  const want = Buffer.from(row.codeHash);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw bad();

  const [used] = await db
    .update(schema.emailCodes)
    .set({ consumedAt: t })
    .where(and(eq(schema.emailCodes.id, row.id), isNull(schema.emailCodes.consumedAt)))
    .returning({ id: schema.emailCodes.id });
  if (!used) throw bad();
  return { email, returnTo: row.returnTo };
}
