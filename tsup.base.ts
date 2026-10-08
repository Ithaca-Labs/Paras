import type { Options } from 'tsup';

/** Shared tsup options for deployable apps (apps/*). */
export const appConfig: Options = {
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so inline them.
  // Every other bare import (pg, zod, ...) stays external and is installed in the image.
  noExternal: [/^@paras\//],
  external: [/^(?!@paras\/|\.|\/)[^.]/],
};
