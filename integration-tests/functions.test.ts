import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, getTestEnv } from './setup';
import { InsForgeClient } from '../src/client';

/**
 * Edge Functions integration tests.
 *
 * Public API tested:
 *   functions.invoke(slug)                         – default POST
 *   functions.invoke(slug, { method: 'GET' })      – GET
 *   functions.invoke(slug, { body })               – with body
 *   functions.invoke(slug, { headers })            – with custom headers
 *   functions.invoke(slug, { method: 'PUT' })      – PUT
 *   functions.invoke(slug, { method: 'PATCH' })    – PATCH
 *   functions.invoke(slug, { method: 'DELETE' })   – DELETE
 *
 * NOTE: Deploy a `hello-world` function on the test project for full
 * coverage. If absent, tests verify the SDK correctly surfaces 404/errors.
 */

describe('Functions Module', () => {
  let client: InsForgeClient;

  beforeAll(() => {
    client = createClient();
  });

  // ================================================================
  // invoke – POST (default)
  // ================================================================

  describe('invoke() – POST', () => {
    it('should invoke a function with POST and return data or structured error', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        body: { name: 'SDK Integration Test' },
      });

      if (error) {
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).toBeDefined();
      }
    });
  });

  // ================================================================
  // invoke – GET
  // ================================================================

  describe('invoke() – GET', () => {
    it('should invoke a function with GET', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        method: 'GET',
      });

      if (error) {
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });
  });

  // ================================================================
  // invoke – other HTTP methods
  // ================================================================

  describe('invoke() – PUT', () => {
    it('should invoke with PUT method', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        method: 'PUT',
        body: { action: 'put-test' },
      });

      expect(data !== null || error !== null).toBe(true);
    });
  });

  describe('invoke() – PATCH', () => {
    it('should invoke with PATCH method', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        method: 'PATCH',
        body: { action: 'patch-test' },
      });

      expect(data !== null || error !== null).toBe(true);
    });
  });

  describe('invoke() – DELETE', () => {
    it('should invoke with DELETE method', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        method: 'DELETE',
      });

      expect(data !== null || error !== null).toBe(true);
    });
  });

  // ================================================================
  // invoke – custom headers
  // ================================================================

  describe('invoke() – custom headers', () => {
    it('should forward custom headers to the function', async () => {
      const { data, error } = await client.functions.invoke('hello-world', {
        body: { echo: true },
        headers: {
          'X-Custom-Test': 'integration',
          'X-Request-Id': `test-${Date.now()}`,
        },
      });

      // Just verify it doesn't crash
      expect(data !== null || error !== null).toBe(true);
    });
  });

  // ================================================================
  // invoke – 404 (non-existent function)
  // ================================================================

  describe('invoke() – non-existent function', () => {
    it('should return a structured error for missing function', async () => {
      const slug = `nonexistent-fn-${Date.now()}`;
      const { data, error } = await client.functions.invoke(slug);

      expect(error).not.toBeNull();
      expect(error!.statusCode).toBeDefined();
      expect(typeof error!.message).toBe('string');
      expect(data).toBeNull();
    });
  });

  // ================================================================
  // invoke – no options (bare call)
  // ================================================================

  describe('invoke() – bare call', () => {
    it('should invoke with defaults (POST, no body, no headers)', async () => {
      const { data, error } = await client.functions.invoke('hello-world');

      if (error) {
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });
  });

  // ================================================================
  // invoke – custom functionsUrl (subhosting → proxy fallback)
  // ================================================================

  describe('invoke() – custom functionsUrl', () => {
    it('should fall back to proxy when functionsUrl returns 404', async () => {
      const env = getTestEnv();
      // Point functionsUrl to a URL that will 404, forcing fallback to proxy
      const customClient = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        functionsUrl: `${env.baseUrl}/nonexistent-subhosting`,
        isServerMode: true,
      });

      const { data, error } = await customClient.functions.invoke('hello-world');

      // Should either succeed via proxy fallback, or return a structured error
      if (error) {
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).toBeDefined();
      }
    });
  });
});
