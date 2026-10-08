import { defineRoute } from '../route.js';
import { z } from '../zod.js';

const Counted = z.object({
  id: z.string(),
  label: z.string(),
  /** Open Events carrying this tag. */
  eventCount: z.number().int(),
});

export const TaxonomyTopic = Counted.extend({ entities: z.array(Counted) });
export const TaxonomyCategory = Counted.extend({ topics: z.array(TaxonomyTopic) });
export type TaxonomyCategory = z.infer<typeof TaxonomyCategory>;

export const listCategories = defineRoute({
  method: 'get',
  path: '/v1/categories',
  operationId: 'listCategories',
  request: {},
  summary:
    'Browse tree: categories -> topics -> entities with open Event counts. Browse Events with `GET /v1/events?category=|topic=|entity=`',
  tags: ['taxonomy'],
  response: z.object({ items: z.array(TaxonomyCategory) }),
});

export const getCategory = defineRoute({
  method: 'get',
  path: '/v1/categories/{id}',
  operationId: 'getCategory',
  summary: 'One category with its topics and entities',
  tags: ['taxonomy'],
  request: { params: z.object({ id: z.string() }) },
  response: TaxonomyCategory,
});
