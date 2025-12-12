import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js builds (with external dependencies)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    minify: false,
    external: ['@insforge/shared-schemas'],
  },
  // Browser bundle (all dependencies bundled)
  {
    entry: { 'browser': 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist',
    splitting: false,
    sourcemap: true,
    minify: false,
    noExternal: ['@insforge/shared-schemas', '@supabase/postgrest-js'],
    platform: 'browser',
    target: 'es2020',
    esbuildOptions(options) {
      options.bundle = true;
    },
  },
]);