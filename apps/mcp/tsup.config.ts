import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source: inline them. Third-party deps stay external.
  noExternal: [/^@paras\//],
});
