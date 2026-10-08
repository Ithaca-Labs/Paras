import { z } from '@paras/shared';
import { defineJob } from './define.js';

/** Smoke-test job proving pg-boss is wired end to end. */
export const systemPing = defineJob({
  name: 'system.ping',
  payload: z.object({ message: z.string() }),
  handler: async ({ message }) => {
    console.log(`system.ping: ${message}`);
  },
});
