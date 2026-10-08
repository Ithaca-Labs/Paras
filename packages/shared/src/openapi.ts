import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ErrorResponse } from './errors.js';
import type { Route } from './route.js';

const json = <T extends Route['response']>(schema: T) => ({
  content: { 'application/json': { schema } },
});

export function buildOpenApiDocument(routes: Record<string, Route>, version = '0.0.0') {
  const registry = new OpenAPIRegistry();
  for (const route of Object.values(routes)) {
    const { params, query, body } = route.request;
    registry.registerPath({
      method: route.method,
      path: route.path,
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      request: {
        // zod-to-openapi accepts object schemas here; route schemas are validated as objects.
        params: params as never,
        query: query as never,
        body: body ? { ...json(body), required: true } : undefined,
      },
      responses: {
        [route.status ?? 200]: { description: 'Success', ...json(route.response) },
        400: { description: 'Validation error', ...json(ErrorResponse) },
        default: { description: 'Error', ...json(ErrorResponse) },
      },
    });
  }
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Paras API', version },
  });
}
