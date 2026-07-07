import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../../lib/http-client';
import { TokenManager } from '../../../lib/token-manager';
import * as tokenManagerModule from '../../../lib/token-manager';
import { Auth } from '../auth';

vi.mock('../helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers')>();
  return {
    ...actual,
    generateCodeVerifier: vi.fn(() => 'a'.repeat(43)),
    generateCodeChallenge: vi.fn(() => Promise.resolve('b'.repeat(43))),
    storePkceVerifier: vi.fn(),
  };
});

function createJsonResponse(status: number, body: any): Response {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;

  (response as any).clone = () => createJsonResponse(status, body);

  return response;
}

describe('Auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('signInWithOAuth()', () => {
    it('sends provider-specific additionalParams during OAuth init', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        })
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { data, error } = await auth.signInWithOAuth('google', {
        redirectTo: 'http://localhost:3000/dashboard',
        additionalParams: {
          prompt: 'select_account',
          login_hint: 'person@example.com',
        },
        skipBrowserRedirect: true,
      });

      expect(error).toBeNull();
      expect(data.url).toBe('https://accounts.google.com/o/oauth2/v2/auth');

      const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requestUrl.pathname).toBe('/api/auth/oauth/google');
      expect(requestUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/dashboard');
      expect(requestUrl.searchParams.get('code_challenge')).toHaveLength(43);
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
      expect(requestUrl.searchParams.get('login_hint')).toBe('person@example.com');
    });

    it('supports the deprecated object wrapper signature', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        })
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { error } = await auth.signInWithOAuth({
        provider: 'google',
        redirectTo: 'http://localhost:3000/dashboard',
        additionalParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      });

      expect(error).toBeNull();

      const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/dashboard');
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
    });

    it('does not let additionalParams override OAuth init fields', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        })
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { error } = await auth.signInWithOAuth('google', {
        redirectTo: 'http://localhost:3000/dashboard',
        additionalParams: {
          redirect_uri: 'https://evil.example/callback',
          code_challenge: 'evil',
          prompt: 'select_account',
        },
        skipBrowserRedirect: true,
      });

      expect(error).toBeNull();

      const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/dashboard');
      expect(requestUrl.searchParams.get('code_challenge')).toHaveLength(43);
      expect(requestUrl.searchParams.get('code_challenge')).not.toBe('evil');
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
      expect(requestUrl.searchParams.has('additionalParams[redirect_uri]')).toBe(false);
      expect(requestUrl.searchParams.has('additionalParams[code_challenge]')).toBe(false);
    });

    it('returns INVALID_INPUT when called without an options object', async () => {
      const fetchMock = vi.fn();
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { error } = await (auth.signInWithOAuth as any)('google');

      expect(error).not.toBeNull();
      expect(error?.statusCode).toBe(400);
      expect(error?.error).toBe('INVALID_INPUT');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns INVALID_INPUT when redirectTo is missing at runtime', async () => {
      const fetchMock = vi.fn();
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { error } = await (auth.signInWithOAuth as any)({
        provider: 'google',
        additionalParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      });

      expect(error).not.toBeNull();
      expect(error?.message).toBe('Redirect URI is required');
      expect(error?.statusCode).toBe(400);
      expect(error?.error).toBe('INVALID_INPUT');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('signOut()', () => {
    it('sends X-CSRF-Token header during browser logout when CSRF token is present', async () => {
      const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, { success: true }));
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: false });

      vi.spyOn(tokenManagerModule, 'getCsrfToken').mockReturnValue('test-csrf-token-abc');

      const { error } = await auth.signOut();

      expect(error).toBeNull();
      expect(fetchMock).toHaveBeenCalled();

      const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(requestUrl).toContain('/api/auth/logout');

      const headers = new Headers(requestInit.headers);
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token-abc');
    });

    it('does not send X-CSRF-Token header in server mode', async () => {
      const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, { success: true }));
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      vi.spyOn(tokenManagerModule, 'getCsrfToken').mockReturnValue('test-csrf-token-abc');

      const { error } = await auth.signOut();

      expect(error).toBeNull();
      expect(fetchMock).toHaveBeenCalled();

      const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(requestUrl).toContain('/api/auth/logout');

      const headers = new Headers(requestInit.headers);
      expect(headers.has('X-CSRF-Token')).toBe(false);
    });

    it('does not send X-CSRF-Token header in browser mode when CSRF token is null', async () => {
      const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, { success: true }));
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager()
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: false });

      vi.spyOn(tokenManagerModule, 'getCsrfToken').mockReturnValue(null);

      const { error } = await auth.signOut();

      expect(error).toBeNull();
      expect(fetchMock).toHaveBeenCalled();

      const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(requestUrl).toContain('/api/auth/logout');

      const headers = new Headers(requestInit.headers);
      expect(headers.has('X-CSRF-Token')).toBe(false);
    });
  });
});
