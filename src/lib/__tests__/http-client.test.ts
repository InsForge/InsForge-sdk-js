import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient } from '../http-client';
import { InsForgeError } from '../../types';
import { TokenManager } from '../token-manager';
import * as tokenManagerModule from '../token-manager';

function createJsonResponse(status: number, body: any, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function createMockTokenManager(): TokenManager {
  return {
    saveSession: vi.fn(),
    clearSession: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    getAccessToken: vi.fn().mockReturnValue(null),
  } as unknown as TokenManager;
}

function createClient(
  fetchFn: ReturnType<typeof vi.fn>,
  overrides: Record<string, any> = {},
  tokenManager?: TokenManager,
) {
  return new HttpClient(
    {
      baseUrl: 'http://localhost:7130',
      fetch: fetchFn as any,
      retryCount: 0,
      timeout: 0,
      ...overrides,
    },
    tokenManager ?? createMockTokenManager(),
  );
}

describe('HttpClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('basic requests', () => {
    it('should make a successful GET request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(200, { id: 1, name: 'test' })
      );

      const client = createClient(mockFetch);
      const result = await client.get('/api/items');

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should make a successful POST request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(201, { id: 2 })
      );

      const client = createClient(mockFetch);
      const result = await client.post('/api/items', { name: 'new' });

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toEqual({ id: 2 });
    });

    it('should merge headers from a Headers instance', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(200, { ok: true })
      );

      const client = createClient(mockFetch);
      await client.get('/api/items', { headers: new Headers({ 'X-Custom': 'value' }) });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      // Headers class lowercases keys per spec
      expect(callHeaders['x-custom']).toBe('value');
    });

    it('should merge headers from a [string, string][] array', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(200, { ok: true })
      );

      const client = createClient(mockFetch);
      await client.get('/api/items', { headers: [['X-Array', 'arr-value'], ['X-Other', 'other']] });

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['X-Array']).toBe('arr-value');
      expect(callHeaders['X-Other']).toBe('other');
    });

    it('should throw InsForgeError on 4xx error', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(401, { error: 'Unauthorized', message: 'Invalid token', statusCode: 401 })
      );

      const client = createClient(mockFetch);
      await expect(client.get('/api/protected')).rejects.toThrow(InsForgeError);
      await expect(client.get('/api/protected')).rejects.toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
      });
    });
  });

  describe('timeout', () => {
    it('should abort and throw REQUEST_TIMEOUT when request exceeds timeout', async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new DOMException('The operation was aborted.', 'AbortError');
            reject(err);
          };
          if (opts?.signal) {
            if (opts.signal.aborted) {
              onAbort();
              return;
            }
            opts.signal.addEventListener('abort', onAbort);
          }
        });
      });

      const client = createClient(mockFetch, { timeout: 50 });

      const error = await client.get('/api/slow').catch((e: unknown) => e) as InsForgeError;
      expect(error).toBeInstanceOf(InsForgeError);
      expect(error.error).toBe('REQUEST_TIMEOUT');
      expect(error.message).toContain('timed out');
    });

    it('should not timeout when timeout is 0 (disabled)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(200, { ok: true })
      );

      const client = createClient(mockFetch, { timeout: 0 });
      const result = await client.get('/api/fast');

      expect(result).toEqual({ ok: true });
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeUndefined();
    });

    it('should succeed if response arrives before timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 10));
        return createJsonResponse(200, { fast: true });
      });

      const client = createClient(mockFetch, { timeout: 5000 });
      const result = await client.get('/api/endpoint');
      expect(result).toEqual({ fast: true });
    });
  });

  describe('retry on network error', () => {
    it('should retry on network error and succeed on subsequent attempt', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(createJsonResponse(200, { recovered: true }));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });
      const result = await client.get('/api/flaky');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ recovered: true });
    });

    it('should throw NETWORK_ERROR after exhausting all retries', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });

      const error = await client.get('/api/down').catch((e: unknown) => e) as InsForgeError;
      expect(error).toBeInstanceOf(InsForgeError);
      expect(error.error).toBe('NETWORK_ERROR');
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should not retry when retryCount is 0', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const client = createClient(mockFetch, { retryCount: 0 });

      await expect(client.get('/api/fail')).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('retry on server error (5xx)', () => {
    it('should retry on 503 and succeed when server recovers', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(createJsonResponse(503, { error: 'Service Unavailable' }, 'Service Unavailable'))
        .mockResolvedValueOnce(createJsonResponse(200, { status: 'ok' }));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });
      const result = await client.get('/api/service');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'ok' });
    });

    it('should retry on 500, 502, 503, 504', async () => {
      for (const status of [500, 502, 503, 504]) {
        const mockFetch = vi.fn()
          .mockResolvedValueOnce(createJsonResponse(status, {}, 'Server Error'))
          .mockResolvedValueOnce(createJsonResponse(200, { fixed: true }));

        const client = createClient(mockFetch, { retryCount: 1, retryDelay: 10 });
        const result = await client.get('/api/test');

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ fixed: true });
      }
    });

    it('should throw after exhausting retries on persistent 500', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(500, { error: 'Internal Server Error', message: 'Something broke', statusCode: 500 }, 'Internal Server Error')
      );

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });

      const error = await client.get('/api/broken').catch((e: unknown) => e) as InsForgeError;
      expect(error).toBeInstanceOf(InsForgeError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('no retry on client errors', () => {
    it('should not retry on 400', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(400, { error: 'Bad Request', message: 'Invalid input', statusCode: 400 })
      );

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      await expect(client.post('/api/submit', { bad: 'data' })).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should not retry on 401', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(401, { error: 'Unauthorized', message: 'No token', statusCode: 401 })
      );

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      await expect(client.get('/api/private')).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should not retry on 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(404, { error: 'Not Found', message: 'Resource missing', statusCode: 404 })
      );

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      await expect(client.get('/api/missing')).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('no retry on non-idempotent methods', () => {
    it('should not retry POST on network error by default', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      await expect(client.post('/api/create', { name: 'test' })).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should not retry PATCH on network error by default', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      await expect(client.patch('/api/update', { name: 'test' })).rejects.toThrow(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should retry POST when idempotent flag is set', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(createJsonResponse(200, { created: true }));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });
      const result = await client.post('/api/create', { name: 'test' }, { idempotent: true });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: true });
    });

    it('should retry PUT on network error (idempotent by default)', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(createJsonResponse(200, { updated: true }));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 10 });
      const result = await client.put('/api/update', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ updated: true });
    });
  });

  describe('signal composition', () => {
    it('should propagate caller abort as-is (not as REQUEST_TIMEOUT)', async () => {
      const callerController = new AbortController();

      const mockFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (opts?.signal) {
            if (opts.signal.aborted) { onAbort(); return; }
            opts.signal.addEventListener('abort', onAbort);
          }
        });
      });

      const client = createClient(mockFetch, { timeout: 0 });

      const promise = client.get('/api/slow', { signal: callerController.signal });
      callerController.abort();

      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    });

    it('should abort backoff sleep when caller signal fires', async () => {
      const callerController = new AbortController();

      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(createJsonResponse(200, { ok: true }));

      const client = createClient(mockFetch, { retryCount: 2, retryDelay: 60_000, timeout: 0 });

      const promise = client.get('/api/slow', { signal: callerController.signal });

      // Abort during the long backoff sleep
      setTimeout(() => callerController.abort(), 50);

      const start = Date.now();
      await expect(promise).rejects.toBeDefined();
      const elapsed = Date.now() - start;

      // Should resolve well under the 60s backoff delay
      expect(elapsed).toBeLessThan(5000);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('malformed response body', () => {
    it('should throw non-retryable error on malformed JSON from 4xx response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
        text: () => Promise.resolve('not json'),
      } as unknown as Response);

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 10 });

      const error = await client.get('/api/bad').catch((e: unknown) => e) as InsForgeError;
      expect(error).toBeInstanceOf(InsForgeError);
      expect(error.error).toBe('REQUEST_FAILED');
      expect(mockFetch).toHaveBeenCalledOnce(); // No retries
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay between retries', async () => {
      const delays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: Function, ms?: number) => {
        if (ms && ms > 0) delays.push(ms);
        return originalSetTimeout(fn, 0);
      }) as any);

      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('fail'))
        .mockRejectedValueOnce(new TypeError('fail'))
        .mockRejectedValueOnce(new TypeError('fail'))
        .mockResolvedValueOnce(createJsonResponse(200, { done: true }));

      const client = createClient(mockFetch, { retryCount: 3, retryDelay: 100, timeout: 0 });
      await client.get('/api/backoff');

      expect(delays.length).toBe(3);
      // With jitter (±15%), delays should roughly be: ~100, ~200, ~400
      expect(delays[0]).toBeGreaterThanOrEqual(85);
      expect(delays[0]).toBeLessThanOrEqual(115);
      expect(delays[1]).toBeGreaterThanOrEqual(170);
      expect(delays[1]).toBeLessThanOrEqual(230);
      expect(delays[2]).toBeGreaterThanOrEqual(340);
      expect(delays[2]).toBeLessThanOrEqual(460);
    });
  });

  describe('custom config', () => {
    it('should respect custom retryCount', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fail'));

      const client = createClient(mockFetch, { retryCount: 5, retryDelay: 1 });
      await client.get('/api/x').catch(() => {});

      expect(mockFetch).toHaveBeenCalledTimes(6); // 1 + 5 retries
    });

    it('should use default values when not specified', () => {
      const mockFetch = vi.fn();
      const client = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: mockFetch as any,
        },
        createMockTokenManager(),
      );

      // Verify the client was created successfully (defaults are set internally)
      expect(client).toBeDefined();
      expect(client.baseUrl).toBe('http://localhost:7130');
    });
  });

  describe('token refresh', () => {
    it('should refresh token and retry on 401 INVALID_TOKEN', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'new-token', user: { id: '1' } }),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { data: 'secret' }),
        );

      const client = createClient(mockFetch, {}, tokenManager);
      const result = await client.get('/api/protected');

      expect(result).toEqual({ data: 'secret' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(tokenManager.saveSession).toHaveBeenCalledOnce();
    });

    it('should NOT refresh token on 401 with other error codes', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(401, { error: 'UNAUTHORIZED', message: 'Forbidden', statusCode: 401 }, 'Unauthorized'),
      );

      const client = createClient(mockFetch, {}, tokenManager);
      const error = await client.get('/api/protected').catch((e: unknown) => e) as InsForgeError;

      expect(error).toBeInstanceOf(InsForgeError);
      expect(error.error).toBe('UNAUTHORIZED');
      expect(mockFetch).toHaveBeenCalledOnce(); // No refresh attempt
    });

    it('should NOT refresh token when autoRefreshToken is false', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
      );

      const client = createClient(mockFetch, { autoRefreshToken: false });
      const error = await client.get('/api/protected').catch((e: unknown) => e) as InsForgeError;

      expect(error).toBeInstanceOf(InsForgeError);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should use new access token on retry after refresh', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'fresh-token', user: { id: '1' } }),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { ok: true }),
        );

      const client = createClient(mockFetch, {}, tokenManager);
      client.setAuthToken('old-token');
      await client.get('/api/protected');

      // Third call (the retry) should use the new token
      const retryCallHeaders = mockFetch.mock.calls[2][1].headers;
      expect(retryCallHeaders['Authorization']).toBe('Bearer fresh-token');
    });

    it('should send refresh token in body when available', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'new-token', user: { id: '1' } }),
        )
        .mockResolvedValueOnce(createJsonResponse(200, {}));

      const client = createClient(mockFetch, {}, tokenManager);
      client.setRefreshToken('my-refresh-token');
      await client.get('/api/protected');

      const refreshCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(refreshCallBody).toEqual({ refreshToken: 'my-refresh-token' });
    });

    it('should send X-CSRF-Token header on refresh when CSRF token is available', async () => {
      const tokenManager = createMockTokenManager();
      vi.spyOn(tokenManagerModule, 'getCsrfToken').mockReturnValue('csrf-abc');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'new-token', user: { id: '1' } }),
        )
        .mockResolvedValueOnce(createJsonResponse(200, {}));

      const client = createClient(mockFetch, {}, tokenManager);
      await client.get('/api/protected');

      const refreshCallHeaders = mockFetch.mock.calls[1][1].headers;
      expect(refreshCallHeaders['X-CSRF-Token']).toBe('csrf-abc');
    });

    it('should send credentials: include on refresh request', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'new-token', user: { id: '1' } }),
        )
        .mockResolvedValueOnce(createJsonResponse(200, {}));

      const client = createClient(mockFetch, {}, tokenManager);
      await client.get('/api/protected');

      expect(mockFetch.mock.calls[1][1].credentials).toBe('include');
    });

    it('should clear session when refresh fails and rethrow refresh error', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'REFRESH_EXPIRED', message: 'Refresh token expired', statusCode: 401 }, 'Unauthorized'),
        );

      const client = createClient(mockFetch, {}, tokenManager);
      const error = await client.get('/api/protected').catch((e: unknown) => e) as InsForgeError;

      expect(error).toBeInstanceOf(InsForgeError);
      expect(error.error).toBe('REFRESH_EXPIRED');
      expect(tokenManager.clearSession).toHaveBeenCalledOnce();
    });

    it('should deduplicate concurrent refresh calls', async () => {
      const tokenManager = createMockTokenManager();
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(401, { error: 'INVALID_TOKEN', message: 'Invalid token', statusCode: 401 }, 'Unauthorized'),
        )
        .mockResolvedValueOnce(
          createJsonResponse(200, { accessToken: 'new-token', user: { id: '1' } }),
        )
        .mockResolvedValue(createJsonResponse(200, { ok: true }));

      const client = createClient(mockFetch, {}, tokenManager);

      await Promise.all([
        client.get('/api/a'),
        client.get('/api/b'),
      ]);

      // Only one refresh call should have been made (call index 2, after the two 401s)
      const refreshCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/auth/sessions/current'),
      );
      expect(refreshCalls).toHaveLength(1);
    });
  });
});
