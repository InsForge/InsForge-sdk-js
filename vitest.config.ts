import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    noExternal: ['@insforge/shared-schemas'],
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['integration-tests/**', 'node_modules/**', 'dist/**'],
    coverage: {
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
  },
});
