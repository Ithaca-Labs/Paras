import { venueLabel } from '@paras/domain';
import { schema } from '@paras/db';
import { apiRoutes } from '@paras/shared';
import { asc } from 'drizzle-orm';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

export const venueRoutes: RoutePlugin = (app, { db }) => {
  implement(app, apiRoutes.listVenues, async () => {
    const rows = await db.select().from(schema.venues).orderBy(asc(schema.venues.id));
    return {
      items: rows.map((v) => ({
        id: v.id,
        name: v.name,
        capabilities: v.capabilities,
        label: venueLabel(v.capabilities),
      })),
    };
  });
};
