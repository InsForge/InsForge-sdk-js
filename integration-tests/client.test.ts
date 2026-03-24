import { describe, it, expect, beforeAll } from 'vitest';
import { getTestEnv } from './setup';
import { InsForgeClient, createClient, InsForgeError, HttpClient } from '../src/index';

/**
 * Client construction and factory integration tests.
 *
 * Public API tested:
 *   new InsForgeClient(config)
 *   createClient(config)          – factory function
 *   client.auth                   – module availability
 *   client.database               – module availability
 *   client.storage                – module availability
 *   client.ai                     – module availability
 *   client.functions              – module availability
 *   client.realtime               – module availability
 *   client.emails                 – module availability
 *   client.getHttpClient()        – returns HttpClient
 *   InsForgeError                 – class construction & fromApiError
 */

describe('InsForgeClient', () => {
  const env = getTestEnv();

  // ================================================================
  // Constructor
  // ================================================================

  describe('constructor', () => {
    it('should create a client with baseUrl and anonKey', () => {
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
      });

      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should create a client with default config', () => {
      const client = new InsForgeClient();
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should create a client in server mode', () => {
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        isServerMode: true,
      });
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should accept custom headers', () => {
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        headers: { 'X-Custom': 'test' },
      });
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should accept timeout and retry config', () => {
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        timeout: 15000,
        retryCount: 1,
        retryDelay: 200,
      });
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should accept debug flag', () => {
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        debug: true,
      });
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should accept a custom debug function', () => {
      const logs: string[] = [];
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        debug: (msg: string) => logs.push(msg),
      });
      expect(client).toBeInstanceOf(InsForgeClient);
    });

    it('should set auth token when edgeFunctionToken is provided', () => {
      const fakeToken = 'edge-fn-jwt-token-abc123';
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        edgeFunctionToken: fakeToken,
      });

      expect(client).toBeInstanceOf(InsForgeClient);
      // The token should be set on the HTTP client
      const headers = client.getHttpClient().getHeaders();
      expect(headers['Authorization']).toBe(`Bearer ${fakeToken}`);
    });

    it('should accept a custom functionsUrl', () => {
      const functionsUrl = 'https://myapp.functions.insforge.app';
      const client = new InsForgeClient({
        baseUrl: env.baseUrl,
        anonKey: env.anonKey,
        functionsUrl,
      });

      expect(client).toBeInstanceOf(InsForgeClient);
      expect(client.functions).toBeDefined();
    });
  });

  // ================================================================
  // Module availability
  // ================================================================

  describe('modules', () => {
    let client: InsForgeClient;

    beforeAll(() => {
      client = new InsForgeClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });
    });

    it('should expose auth module', () => {
      expect(client.auth).toBeDefined();
      expect(typeof client.auth.signUp).toBe('function');
      expect(typeof client.auth.signInWithPassword).toBe('function');
      expect(typeof client.auth.signOut).toBe('function');
      expect(typeof client.auth.getCurrentUser).toBe('function');
      expect(typeof client.auth.getProfile).toBe('function');
      expect(typeof client.auth.setProfile).toBe('function');
      expect(typeof client.auth.refreshSession).toBe('function');
      expect(typeof client.auth.signInWithOAuth).toBe('function');
      expect(typeof client.auth.exchangeOAuthCode).toBe('function');
      expect(typeof client.auth.signInWithIdToken).toBe('function');
      expect(typeof client.auth.resendVerificationEmail).toBe('function');
      expect(typeof client.auth.verifyEmail).toBe('function');
      expect(typeof client.auth.sendResetPasswordEmail).toBe('function');
      expect(typeof client.auth.exchangeResetPasswordToken).toBe('function');
      expect(typeof client.auth.resetPassword).toBe('function');
      expect(typeof client.auth.getPublicAuthConfig).toBe('function');
    });

    it('should expose database module', () => {
      expect(client.database).toBeDefined();
      expect(typeof client.database.from).toBe('function');
      expect(typeof client.database.rpc).toBe('function');
    });

    it('should expose storage module', () => {
      expect(client.storage).toBeDefined();
      expect(typeof client.storage.from).toBe('function');
    });

    it('should expose ai module with sub-modules', () => {
      expect(client.ai).toBeDefined();
      expect(client.ai.chat).toBeDefined();
      expect(client.ai.chat.completions).toBeDefined();
      expect(typeof client.ai.chat.completions.create).toBe('function');
      expect(client.ai.embeddings).toBeDefined();
      expect(typeof client.ai.embeddings.create).toBe('function');
      expect(client.ai.images).toBeDefined();
      expect(typeof client.ai.images.generate).toBe('function');
    });

    it('should expose functions module', () => {
      expect(client.functions).toBeDefined();
      expect(typeof client.functions.invoke).toBe('function');
    });

    it('should expose realtime module', () => {
      expect(client.realtime).toBeDefined();
      expect(typeof client.realtime.connect).toBe('function');
      expect(typeof client.realtime.disconnect).toBe('function');
      expect(typeof client.realtime.subscribe).toBe('function');
      expect(typeof client.realtime.unsubscribe).toBe('function');
      expect(typeof client.realtime.publish).toBe('function');
      expect(typeof client.realtime.on).toBe('function');
      expect(typeof client.realtime.off).toBe('function');
      expect(typeof client.realtime.once).toBe('function');
      expect(typeof client.realtime.getSubscribedChannels).toBe('function');
    });

    it('should expose emails module', () => {
      expect(client.emails).toBeDefined();
      expect(typeof client.emails.send).toBe('function');
    });
  });

  // ================================================================
  // getHttpClient()
  // ================================================================

  describe('getHttpClient()', () => {
    it('should return an HttpClient instance', () => {
      const client = new InsForgeClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });
      const http = client.getHttpClient();

      expect(http).toBeDefined();
      expect(http).toBeInstanceOf(HttpClient);
      expect(http.baseUrl).toBe(env.baseUrl);
      expect(typeof http.get).toBe('function');
      expect(typeof http.post).toBe('function');
      expect(typeof http.put).toBe('function');
      expect(typeof http.patch).toBe('function');
      expect(typeof http.delete).toBe('function');
      expect(typeof http.request).toBe('function');
      expect(typeof http.setAuthToken).toBe('function');
      expect(typeof http.getHeaders).toBe('function');
    });
  });

  // ================================================================
  // createClient() factory
  // ================================================================

  describe('createClient() factory', () => {
    it('should create a client identical to new InsForgeClient()', () => {
      const client = createClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });

      expect(client).toBeInstanceOf(InsForgeClient);
      expect(client.auth).toBeDefined();
      expect(client.database).toBeDefined();
      expect(client.storage).toBeDefined();
      expect(client.ai).toBeDefined();
      expect(client.functions).toBeDefined();
      expect(client.realtime).toBeDefined();
      expect(client.emails).toBeDefined();
    });
  });

  // ================================================================
  // InsForgeError
  // ================================================================

  describe('InsForgeError', () => {
    it('should construct with message, statusCode, error', () => {
      const err = new InsForgeError('test error', 400, 'BAD_REQUEST');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(InsForgeError);
      expect(err.message).toBe('test error');
      expect(err.statusCode).toBe(400);
      expect(err.error).toBe('BAD_REQUEST');
      expect(err.name).toBe('InsForgeError');
    });

    it('should construct with nextActions', () => {
      const err = new InsForgeError('test', 400, 'ERR', 'Try again');
      expect(err.nextActions).toBe('Try again');
    });

    it('fromApiError() should create from API error object', () => {
      const err = InsForgeError.fromApiError({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        statusCode: 422,
        nextActions: 'Check your input',
      });

      expect(err).toBeInstanceOf(InsForgeError);
      expect(err.message).toBe('Invalid input');
      expect(err.statusCode).toBe(422);
      expect(err.error).toBe('VALIDATION_ERROR');
      expect(err.nextActions).toBe('Check your input');
    });
  });
});
