import { apiRoutes } from '@paras/shared';
import { sql } from 'drizzle-orm';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

export const healthRoutes: RoutePlugin = (app, { db, adapters }) => {
  implement(app, apiRoutes.getHealth, async () => {
    const dbUp = await db.execute(sql`select 1`).then(
      () => true,
      () => false,
    );
    return { status: 'ok' as const, db: dbUp, venues: [...adapters.keys()] };
  });
};
