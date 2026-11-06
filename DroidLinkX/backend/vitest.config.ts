import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    fileParallelism: false,
    testTimeout: 45_000,
    hookTimeout: 45_000,
    setupFiles: ['tests/setup.ts'],
    reporters: ['default'],
  },
});
