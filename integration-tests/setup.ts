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

/**
 * Sign up a fresh user and return an authenticated client.
 * Re-usable across every test file that needs an auth context.
 */
export async function signUpFreshUser() {
  const client = createClient();
  const email = uniqueEmail();

  const { data, error } = await client.auth.signUp({
    email,
    password: TEST_PASSWORD,
    name: 'SDK Integration Test',
  });

  return { client, email, password: TEST_PASSWORD, data, error };
}

/**
 * Sign up and get an authenticated client.
 *
 * Many InsForge projects require email verification before signIn works.
 * In that case signUp still returns an accessToken (set on the client
 * automatically), so we use that token directly rather than requiring
 * a separate signInWithPassword call.
 *
 * Falls back to signIn if signUp doesn't return an accessToken.
 */
export async function signUpAndSignIn() {
  const email = uniqueEmail();
  const client = createClient();

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email,
    password: TEST_PASSWORD,
    name: 'SDK Integration Test',
  });

  if (signUpError) {
    return { client, email, password: TEST_PASSWORD, data: null, error: signUpError };
  }

  // signUp already sets the token on the client if accessToken is present
  if (signUpData?.accessToken) {
    return { client, email, password: TEST_PASSWORD, data: signUpData, error: null };
  }

  // Fallback: try explicit sign-in (works when email verification is disabled)
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });

  if (error) {
    // Only treat email-verification-required as a non-error (expected in many projects)
    const msg = (error.message || '').toLowerCase();
    const isVerificationRequired =
      msg.includes('verify') || msg.includes('confirm') || msg.includes('verification');

    if (isVerificationRequired) {
      // Return the client with just the anon key – all modules work via HttpClient
      return { client, email, password: TEST_PASSWORD, data: signUpData, error: null };
    }

    // Propagate unexpected sign-in errors so tests fail fast
    return { client, email, password: TEST_PASSWORD, data: null, error };
  }

  return { client, email, password: TEST_PASSWORD, data, error };
}
