import { z } from './zod.js';

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
