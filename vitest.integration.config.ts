import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Force Vite to pre-bundle @insforge/shared-schemas so its
  // extensionless ESM imports (e.g. './database.schema') are resolved
  // by Vite's bundler instead of Node's strict ESM resolver.
  optimizeDeps: {
    include: ['@insforge/shared-schemas'],
  },
  ssr: {
    // Ensure the dependency is NOT treated as external in SSR/Node mode
    noExternal: ['@insforge/shared-schemas'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['integration-tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 15000,
    sequence: {
      concurrent: false,
    },
  },
});
