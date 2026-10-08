/** Width of every stored embedding (pgvector column size). Matches all-MiniLM-L6-v2 and bge-small. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Turns text into unit-length vectors. The one seam between Paras and any embedding model:
 * production uses a self-hosted sentence model (`@paras/embeddings`), tests use a deterministic fake.
 * Reused by search (#9), matching (#6), onboarding (#11) and the Feed (#12).
 */
export interface Embedder {
  /** Vector length; must equal {@link EMBEDDING_DIMENSIONS} to be stored. */
  readonly dimensions: number;
  /** One L2-normalized vector per input text, in order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** Cosine similarity in [-1, 1]; 0 if either vector is all zeros. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

/** Scale to unit length (zero vectors are returned unchanged). */
export function normalize(v: readonly number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? [...v] : v.map((x) => x / n);
}

/** Weighted mean of vectors, normalized. Used to blend an Interest Profile from several inputs. */
export function meanVector(
  vectors: readonly (readonly number[])[],
  weights?: readonly number[],
): number[] {
  const first = vectors[0];
  if (!first) return [];
  const out = new Array<number>(first.length).fill(0);
  vectors.forEach((v, i) => {
    const w = weights?.[i] ?? 1;
    for (let j = 0; j < out.length; j++) out[j]! += w * v[j]!;
  });
  return normalize(out);
}

const DESCRIPTION_CHARS = 500;

/**
 * The text embedded for an Event: title plus the start of its description (resolution rules often
 * carry the entities and thresholds). Changing this means re-embedding (see `embeddedHash`
 * in packages/db: set `embedded_hash` to NULL to force it).
 */
export function eventEmbeddingText(e: { title: string; description: string }): string {
  return `${e.title}\n${e.description.slice(0, DESCRIPTION_CHARS)}`;
}
