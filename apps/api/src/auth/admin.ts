import { schema, type Database } from '@paras/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '../errors.js';

/** 403 unless the User has the `admin` role. Shared by every admin/ops route. */
export async function assertAdmin(db: Database, userId: string) {
  const [u] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (u?.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only');
}
