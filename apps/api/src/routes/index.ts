import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { authRoutes } from './auth.js';
import { compareRoutes } from './compare.js';
import { eventRoutes } from './events.js';
import { healthRoutes } from './health.js';
import { jurisdictionRoutes } from './jurisdiction.js';
import { magicLinkRoutes } from './magic-links.js';
import { openapiRoutes } from './openapi.js';
import { taxonomyRoutes } from './taxonomy.js';
import { venueRoutes } from './venues.js';

export type RoutePlugin = (app: FastifyInstance, deps: AppDeps) => void;

/**
 * One RoutePlugin per resource. To add endpoints: declare the route in @paras/shared
 * (packages/shared/src/routes), implement it in a new file here with `implement(...)`
 * (or `implementSse` for Server-Sent Events), and append the plugin below.
 */
export const routePlugins: RoutePlugin[] = [
  healthRoutes,
  authRoutes,
  eventRoutes,
  compareRoutes,
  magicLinkRoutes,
  taxonomyRoutes,
  venueRoutes,
  jurisdictionRoutes,
  openapiRoutes,
];
