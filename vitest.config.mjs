import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/src/**/*.test.mjs',
      'apps/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.mjs',
      'tests/**/*.test.ts',
      'tests/**/*.test.mjs',
    ],
    fileParallelism: false,
    passWithNoTests: false,
  },
});
