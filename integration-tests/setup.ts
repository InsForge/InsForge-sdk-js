/**
 * Shared setup for integration tests.
 *
 * Environment variables:
 *   INSFORGE_INTEGRATION_BASE_URL  – required, e.g. https://xxx.us-east.insforge.app
 *   INSFORGE_INTEGRATION_ANON_KEY  – required, project anon key
 *
 * The suite creates its own users so no pre-existing credentials are needed.
 */

import { InsForgeClient } from '../src/client';
import { createClient as createClientFactory } from '../src/index';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export interface TestEnv {
  baseUrl: string;
  anonKey: string;
}

let _env: TestEnv | null = null;

export function getTestEnv(): TestEnv {
  if (_env) return _env;

  const baseUrl = (
    process.env.INSFORGE_INTEGRATION_BASE_URL ||
    process.env.INSFORGE_TEST_URL ||
    ''
  ).replace(/\/+$/, '');

  const anonKey =
    process.env.INSFORGE_INTEGRATION_ANON_KEY ||
    process.env.INSFORGE_TEST_ANON_KEY ||
    '';

  if (!baseUrl) {
    throw new Error(
      'Missing INSFORGE_INTEGRATION_BASE_URL. Example:\n' +
        '  INSFORGE_INTEGRATION_BASE_URL=https://gv5eyqe5.us-east.insforge.app \\\n' +
        '  INSFORGE_INTEGRATION_ANON_KEY=<key> \\\n' +
        '  npm run test:integration'
    );
  }

  if (!anonKey) {
    throw new Error(
      'Missing INSFORGE_INTEGRATION_ANON_KEY. Provide the project anon key.'
    );
  }

  _env = { baseUrl, anonKey };
  return _env;
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/** Create a plain (unauthenticated) client in server mode. */
export function createClient(overrides?: Partial<TestEnv>): InsForgeClient {
  const env = getTestEnv();
  return new InsForgeClient({
    baseUrl: overrides?.baseUrl ?? env.baseUrl,
    anonKey: overrides?.anonKey ?? env.anonKey,
    isServerMode: true,
  });
}

/** Same thing using the `createClient` factory export (covers that code path). */
export function createClientViaFactory(overrides?: Partial<TestEnv>): InsForgeClient {
  const env = getTestEnv();
  return createClientFactory({
    baseUrl: overrides?.baseUrl ?? env.baseUrl,
    anonKey: overrides?.anonKey ?? env.anonKey,
    isServerMode: true,
  });
}

// ---------------------------------------------------------------------------
// Test-user helpers
// ---------------------------------------------------------------------------

/** Generate a unique email that won't collide across parallel runs. */
export function uniqueEmail(prefix = 'sdktest'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}+${ts}-${rand}@test.insforge.dev`;
}

const TEST_PASSWORD = 'Test_P@ssword_123!';

export { TEST_PASSWORD };

// ---------------------------------------------------------------------------
// Fixed test account (pre-verified, for authenticated tests)
// ---------------------------------------------------------------------------

function getFixedTestAccount() {
  const email = process.env.INSFORGE_INTEGRATION_TEST_EMAIL || '';
  const password = process.env.INSFORGE_INTEGRATION_TEST_PASSWORD || '';

  if (!email || !password) {
    throw new Error(
      'Missing INSFORGE_INTEGRATION_TEST_EMAIL or INSFORGE_INTEGRATION_TEST_PASSWORD.\n' +
        'These must be a pre-verified account for authenticated integration tests.'
    );
  }

  return { email, password };
}

/**
 * Sign in with a fixed pre-verified account and return an authenticated client.
 *
 * Used by most test files (ai, database, storage, realtime, email) that
 * need a valid auth session. Since email verification is enabled,
 * freshly signed-up users cannot authenticate — use this instead.
 */
export async function signUpAndSignIn() {
  const { email, password } = getFixedTestAccount();
  const client = createClient();

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    return { client, email, password, data: null, error };
  }

  return { client, email, password, data, error: null };
}

/**
 * Sign up a fresh (unverified) user. Used by auth tests that specifically
 * test the registration flow, profile updates, verification, etc.
 *
 * The returned client may NOT have a valid auth session (email verification
 * required). Callers should handle this accordingly.
 */
export async function signUpFreshUser() {
  const email = uniqueEmail();
  const client = createClient();

  const { data, error } = await client.auth.signUp({
    email,
    password: TEST_PASSWORD,
    name: 'SDK Integration Test',
  });

  return { client, email, password: TEST_PASSWORD, data, error };
}
