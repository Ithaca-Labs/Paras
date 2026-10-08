import { defineRoute } from '../route.js';
import { z } from '../zod.js';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  db: z.boolean(),
  venues: z.array(z.string()),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const getHealth = defineRoute({
  method: 'get',
  path: '/v1/health',
  operationId: 'getHealth',
  summary: 'Liveness and dependency check',
  tags: ['system'],
  request: {},
  response: HealthResponse,
});
