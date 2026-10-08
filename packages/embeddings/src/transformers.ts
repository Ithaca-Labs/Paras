import { EMBEDDING_DIMENSIONS, type Embedder } from '@paras/domain';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface TransformersEmbedderOptions {
  /** Hugging Face model id; must output 384-dim sentence embeddings (MiniLM, bge-small, ...). */
  model?: string;
  /** Where weights are cached on disk. Default: transformers.js's own cache. */
  cacheDir?: string;
  /** Texts per forward pass. */
  batchSize?: number;
}

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Self-hosted sentence embeddings via transformers.js (ONNX, CPU). Free, no external API.
 * The model downloads on first use and is then cached; the library is imported lazily so apps
 * that never embed (and tests) pay nothing. Concurrent calls share one model load.
 */
export function createTransformersEmbedder(options: TransformersEmbedderOptions = {}): Embedder {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const batchSize = options.batchSize ?? 32;
  let loading: Promise<Extractor> | undefined;

  const load = (): Promise<Extractor> =>
    (loading ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (options.cacheDir) env.cacheDir = options.cacheDir;
      const extractor = await pipeline('feature-extraction', model, { dtype: 'fp32' });
      return extractor as unknown as Extractor;
    })().catch((err) => {
      loading = undefined; // allow retry after a failed download
      throw err;
    }));

  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (!texts.length) return [];
      const extract = await load();
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const res = await extract(texts.slice(i, i + batchSize), {
          pooling: 'mean',
          normalize: true,
        });
        out.push(...res.tolist());
      }
      if (out[0] && out[0].length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`${model} outputs ${out[0].length} dims, expected ${EMBEDDING_DIMENSIONS}`);
      }
      return out;
    },
  };
}
