import { TAXONOMY, taxonomyCategories, taxonomyChildren, type TaxonomyNode } from '@paras/domain';
import { apiRoutes, type TaxonomyCategory } from '@paras/shared';
import { notFound } from '../errors.js';
import { tagCounts } from '../events/queries.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

export const taxonomyRoutes: RoutePlugin = (app, { db }) => {
  const tree = async (nodes: TaxonomyNode[]): Promise<TaxonomyCategory[]> => {
    const counts = await tagCounts(db);
    const leaf = (n: TaxonomyNode) => ({
      id: n.id,
      label: n.label,
      eventCount: counts.get(n.id) ?? 0,
    });
    return nodes.map((c) => ({
      ...leaf(c),
      topics: taxonomyChildren(c.id).map((t) => ({
        ...leaf(t),
        entities: taxonomyChildren(t.id).map(leaf),
      })),
    }));
  };

  implement(app, apiRoutes.listCategories, async () => ({
    items: await tree(taxonomyCategories()),
  }));

  implement(app, apiRoutes.getCategory, async ({ params }) => {
    const node = TAXONOMY.find((n) => n.id === params.id && n.kind === 'category');
    if (!node) throw notFound('Category');
    return (await tree([node]))[0]!;
  });
};
