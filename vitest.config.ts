import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/app.ts', 'src/**/*.d.ts', 'src/templates/**'],
    },
  },
});
