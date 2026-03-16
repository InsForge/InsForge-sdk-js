#!/usr/bin/env node

/**
 * Integration test runner.
 * Delegates to Vitest and targets files in integration-tests/*.test.ts
 * so CI/local execution stays consistent.
 */

const { spawnSync } = require('node:child_process');

function runAllTests() {
  console.log('Running integration tests via Vitest...');

  const result = spawnSync(
    'npx',
    ['vitest', 'run', '--dir', 'integration-tests'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    }
  );

  if (result.error) {
    console.error('Failed to launch Vitest:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
