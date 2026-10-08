import { apiRoutes, buildOpenApiDocument, sseRoutes } from '@paras/shared';
import type { RoutePlugin } from './index.js';

export const openapiRoutes: RoutePlugin = (app) => {
  const doc = buildOpenApiDocument(apiRoutes, sseRoutes);
  app.get('/v1/openapi.json', async () => doc);
};
