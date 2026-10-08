import { pickMergeSurvivor } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import type { Me } from '@paras/shared';
import { eq } from 'drizzle-orm';
import { moveFeedState } from '../feed/move.js';
import { mergeProfiles } from '../profile/store.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Identity =
  { kind: 'wallet'; address: string; chainId: number } | { kind: 'email'; email: string };

export interface LoginOutcome {
  userId: string;
  /** An identity was attached to an already signed-in User. */
  linked: boolean;
  /** A second existing User was absorbed in the process. */
  merged: boolean;
}

async function ownerOf(tx: Tx, identity: Identity): Promise<string | null> {
  if (identity.kind === 'wallet') {
    const [row] = await tx
      .select({ userId: schema.walletLinks.userId })
      .from(schema.walletLinks)
      .where(eq(schema.walletLinks.address, identity.address));
    return row?.userId ?? null;
  }
  const [row] = await tx
    .select({ userId: schema.emailIdentities.userId })
    .from(schema.emailIdentities)
    .where(eq(schema.emailIdentities.email, identity.email));
  return row?.userId ?? null;
}

async function attach(tx: Tx, userId: string, identity: Identity) {
  if (identity.kind === 'wallet') {
    await tx
      .insert(schema.walletLinks)
      .values({ userId, address: identity.address, chainId: identity.chainId });
  } else {
    await tx.insert(schema.emailIdentities).values({ userId, email: identity.email });
  }
}

/**
 * Merge two Users into the older one (see pickMergeSurvivor). All wallets, emails and sessions move
 * to the survivor; the absorbed row stays as a tombstone (`mergedIntoId`).
 *
 * Any later table that is owned by a User (Interest Profile, Follows, OAuth grants, ...) MUST be
 * repointed here too, and conflicts (e.g. one profile per user) resolved explicitly.
 */
export async function mergeUsers(tx: Tx, aId: string, bId: string): Promise<string> {
  const [a, b] = await Promise.all(
    [aId, bId].map(async (id) => {
      const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
      if (!u) throw new Error(`user ${id} missing`);
      return u;
    }),
  );
  const { survivor, absorbed } = pickMergeSurvivor(a!, b!);
  for (const t of [
    schema.walletLinks,
    schema.emailIdentities,
    schema.authSessions,
    schema.magicLinks,
  ]) {
    await tx.update(t).set({ userId: survivor.id }).where(eq(t.userId, absorbed.id));
  }
  await mergeProfiles(tx, survivor.id, absorbed.id);
  await moveFeedState(tx, `u:${absorbed.id}`, `u:${survivor.id}`);
  await tx
    .update(schema.users)
    .set({ mergedIntoId: survivor.id })
    .where(eq(schema.users.id, absorbed.id));
  return survivor.id;
}

/**
 * Resolve a proven identity to a User.
 * - Signed out: existing owner logs in; otherwise a new User is created.
 * - Signed in (`currentUserId`): unowned identity is attached; already ours is a no-op;
 *   owned by another User merges both (the caller proved both: a live session + the identity).
 */
export function resolveIdentity(
  db: Database,
  identity: Identity,
  currentUserId: string | null,
): Promise<LoginOutcome> {
  return db.transaction(async (tx) => {
    const owner = await ownerOf(tx, identity);
    if (!currentUserId) {
      if (owner) return { userId: owner, linked: false, merged: false };
      const [u] = await tx.insert(schema.users).values({}).returning({ id: schema.users.id });
      await attach(tx, u!.id, identity);
      return { userId: u!.id, linked: false, merged: false };
    }
    if (!owner) {
      await attach(tx, currentUserId, identity);
      return { userId: currentUserId, linked: true, merged: false };
    }
    if (owner === currentUserId) return { userId: currentUserId, linked: false, merged: false };
    const userId = await mergeUsers(tx, currentUserId, owner);
    return { userId, linked: true, merged: true };
  });
}

export async function loadMe(db: Database, userId: string): Promise<Me> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new Error(`user ${userId} missing`);
  const [wallets, emails] = await Promise.all([
    db.select().from(schema.walletLinks).where(eq(schema.walletLinks.userId, userId)),
    db.select().from(schema.emailIdentities).where(eq(schema.emailIdentities.userId, userId)),
  ]);
  return {
    id: user.id,
    createdAt: user.createdAt.toISOString(),
    emails: emails.map((e) => e.email).sort(),
    wallets: wallets
      .map((w) => ({ address: w.address, chainId: w.chainId }))
      .sort((x, y) => x.address.localeCompare(y.address)),
  };
}
