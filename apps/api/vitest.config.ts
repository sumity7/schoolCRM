import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000, // first run downloads mongod for mongodb-memory-server
    pool: 'forks',
    // Each test FILE gets its own database; files may run in parallel.
    coverage: { provider: 'v8', include: ['src/core/**', 'src/modules/**'], reporter: ['text-summary', 'html'] },
  },
});
