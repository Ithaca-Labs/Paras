import { cosine } from './embedding.js';
import type { TagKind, TaxonomyIndex } from './taxonomy.js';

export interface TaggingInput {
  title: string;
  description: string;
  /** Venue-provided category and tags of the Event's Markets (may be empty, e.g. Polymarket /markets). */
  venueLabels: readonly string[];
  /** Embedding of the Event text; omit to tag by keywords only. */
  vector?: readonly number[] | undefined;
}

export interface TaggingOptions {
  /** Minimum score to keep a category / topic. Entities are keyword-only. */
  categoryMin: number;
  topicMin: number;
  maxCategories: number;
  maxTopics: number;
  /** Description text beyond this many characters is ignored for keyword matching. */
  descriptionChars: number;
}

export const DEFAULT_TAGGING: TaggingOptions = {
  categoryMin: 0.35,
  topicMin: 0.4,
  maxCategories: 2,
  maxTopics: 3,
  descriptionChars: 300,
};

export type TagSource = 'venue' | 'keyword' | 'embedding';

export interface EventTag {
  id: string;
  kind: TagKind;
  /** 0..1 confidence; keyword hits score 0.5 to 0.9, embedding hits are cosine similarity. */
  score: number;
  source: TagSource;
}

export interface TaggingResult {
  tags: EventTag[];
  /** Highest-scoring category id, or null if nothing cleared the threshold. */
  category: string | null;
}

const SCORE_TITLE = 0.9;
const SCORE_VENUE = 0.85;
const SCORE_DESCRIPTION = 0.5;
const PROPAGATE = 0.9;
const SECONDARY_CATEGORY_RATIO = 0.85;

/**
 * Tag an Event against the taxonomy. Signals, per node: keyword hit in the title (0.9), in the
 * Venue's own category/tags (0.85) or in the start of the description (0.5), and cosine similarity
 * between the Event vector and the node vector. Child hits lift their parent (x0.9), so an Event
 * about "Lakers" is also tagged NBA and Sports. Pure and deterministic.
 */
export function tagEvent(
  input: TaggingInput,
  index: TaxonomyIndex,
  options: Partial<TaggingOptions> = {},
): TaggingResult {
  const o = { ...DEFAULT_TAGGING, ...options };
  const title = input.title.toLowerCase();
  const description = input.description.slice(0, o.descriptionChars).toLowerCase();
  const venue = input.venueLabels.join(' | ').toLowerCase();

  const scores = new Map<string, EventTag>();
  const offer = (id: string, kind: TagKind, score: number, source: TagSource) => {
    const prev = scores.get(id);
    if (!prev || score > prev.score) scores.set(id, { id, kind, score, source });
  };

  for (const node of index.nodes) {
    const re = index.matchers.get(node.id)!;
    if (re.test(title)) offer(node.id, node.kind, SCORE_TITLE, 'keyword');
    else if (venue && re.test(venue)) offer(node.id, node.kind, SCORE_VENUE, 'venue');
    else if (node.kind !== 'entity' && re.test(description)) {
      offer(node.id, node.kind, SCORE_DESCRIPTION, 'keyword');
    }
    if (input.vector && node.kind !== 'entity') {
      offer(
        node.id,
        node.kind,
        Math.max(0, cosine(input.vector, index.vectors.get(node.id)!)),
        'embedding',
      );
    }
  }

  const parentOf = new Map(index.nodes.map((n) => [n.id, n]));
  const kept = new Map<string, EventTag>();
  const keep = (t: EventTag) => {
    const prev = kept.get(t.id);
    if (!prev || t.score > prev.score) kept.set(t.id, t);
  };

  const entities = [...scores.values()].filter(
    (t) => t.kind === 'entity' && t.score >= SCORE_VENUE,
  );
  const topics = [...scores.values()]
    .filter((t) => t.kind === 'topic' && t.score >= o.topicMin)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, o.maxTopics);
  entities.forEach(keep);
  topics.forEach(keep);

  // Lift: entity -> topic -> category.
  const lift = (child: EventTag) => {
    const parent = parentOf.get(child.id)?.parent;
    if (!parent) return;
    const node = parentOf.get(parent)!;
    const lifted: EventTag = {
      id: parent,
      kind: node.kind,
      score: child.score * PROPAGATE,
      source: child.source,
    };
    const own = scores.get(parent);
    keep(own && own.score >= lifted.score ? own : lifted);
    lift(lifted);
  };
  [...kept.values()].forEach(lift);
  // Categories that cleared the bar on their own.
  for (const t of scores.values()) if (t.kind === 'category' && t.score >= o.categoryMin) keep(t);

  const categories = [...kept.values()]
    .filter((t) => t.kind === 'category' && t.score >= o.categoryMin)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = categories[0];
  const keepCats = new Set(
    categories
      .filter((t) => t === best || t.score >= best!.score * SECONDARY_CATEGORY_RATIO)
      .slice(0, o.maxCategories)
      .map((t) => t.id),
  );
  const rootOf = (id: string): string => {
    let n = parentOf.get(id)!;
    while (n.parent) n = parentOf.get(n.parent)!;
    return n.id;
  };
  const tags = [...kept.values()]
    .filter((t) => keepCats.has(rootOf(t.id)))
    .map((t) => ({ ...t, score: Math.round(t.score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { tags, category: best?.id ?? null };
}
