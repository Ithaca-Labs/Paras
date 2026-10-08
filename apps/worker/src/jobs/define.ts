import type { z } from '@paras/shared';

export interface JobDefinition<T extends z.ZodType = z.ZodType> {
  /** pg-boss queue name, `<area>.<verb>`, e.g. `venue.sync`. */
  name: string;
  /** Payload schema; payloads are validated before the handler runs. */
  payload: T;
  handler: (data: z.output<T>) => Promise<void>;
}

export const defineJob = <T extends z.ZodType>(job: JobDefinition<T>): JobDefinition<T> => job;
