import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['@paras/testkit/global-setup'], hookTimeout: 120_000 },
});
