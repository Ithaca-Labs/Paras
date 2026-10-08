import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { authRoutes } from './auth.js';
import { healthRoutes } from './health.js';
import { openapiRoutes } from './openapi.js';

export type RoutePlugin = (app: FastifyInstance, deps: AppDeps) => void;

/**
 * One RoutePlugin per resource. To add endpoints: declare the route in @paras/shared
 * (packages/shared/src/routes), implement it in a new file here with `implement(...)`,
 * and append the plugin below.
 */
export const routePlugins: RoutePlugin[] = [healthRoutes, authRoutes, openapiRoutes];
