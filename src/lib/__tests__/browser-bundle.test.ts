import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build as buildSdk } from 'tsup';
import { build as buildBrowser, createLogger } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('browser SDK bundles', () => {
  let tempDir: string;

  beforeAll(async () => {
    // Vite only reports browser externalization warnings in production builds.
    vi.stubEnv('NODE_ENV', 'production');
    // Keep dependency resolution intact without relying on a stale dist directory.
    tempDir = await mkdtemp(join(resolve('node_modules'), '.sdk-browser-'));
    await buildSdk({
      config: 'tsup.config.ts',
      outDir: join(tempDir, 'dist'),
      dts: false,
      sourcemap: false,
      silent: true,
    });
  }, 30000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['index', 'createClient'],
    ['ssr', 'createBrowserClient'],
  ])('bundles %s for the browser without Node crypto warnings', async (entry, clientFactory) => {
    const consumer = join(tempDir, `${entry}-consumer.mjs`);
    // Retain the client so tree shaking cannot hide its auth helper's import.
    await writeFile(
      consumer,
      `import { ${clientFactory} } from './dist/${entry}.mjs';\nconsole.log(${clientFactory});\n`
    );

    const warnings: string[] = [];
    const logger = createLogger('warn');
    const warn = logger.warn.bind(logger);
    logger.warn = (message, options) => {
      warnings.push(message);
      warn(message, options);
    };
    logger.warnOnce = logger.warn;

    await buildBrowser({
      configFile: false,
      root: tempDir,
      customLogger: logger,
      plugins: [
        {
          name: 'verify-production-build',
          configResolved: (config) => {
            expect(config.isProduction).toBe(true);
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: consumer },
      },
    });

    expect(warnings.filter((message) => /(?:node:)?crypto.*externalized/i.test(message))).toEqual(
      []
    );
  });
});
