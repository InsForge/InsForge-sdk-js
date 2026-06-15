import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const bundleFiles = ['dist/ssr/middleware.mjs', 'dist/ssr/middleware.js'];
const forbiddenTokens = [
  '@supabase/postgrest-js',
  'postgrest',
  'socket.io-client',
  'socket.io',
  'InsForgeClient',
  'database-postgrest',
  'realtime',
  '../client',
];

let failed = false;

for (const file of bundleFiles) {
  const path = resolve(repoRoot, file);
  let contents;

  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    console.error(
      `Missing ${file}. Run npm run build before npm run test:bundle.`,
    );
    failed = true;
    continue;
  }

  for (const token of forbiddenTokens) {
    if (contents.includes(token)) {
      console.error(`${file} contains forbidden token: ${token}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('SSR middleware bundle isolation check passed.');
