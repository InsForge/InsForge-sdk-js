import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../../lib/http-client';
import { TokenManager } from '../../../lib/token-manager';
import { Auth } from '../auth';

function createJsonResponse(status: number, body: any): Response {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;

  return {
    ...response,
    clone: () => response,
  } as Response;
}

describe('Auth', () => {
  describe('signInWithOAuth()', () => {
    it('sends provider-specific additionalParams during OAuth init', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        }),
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager(),
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { data, error } = await auth.signInWithOAuth(
        'google',
        {
          redirectTo: 'http://localhost:3000/dashboard',
          additionalParams: {
            prompt: 'select_account',
            login_hint: 'person@example.com',
          },
          skipBrowserRedirect: true,
        },
      );

      expect(error).toBeNull();
      expect(data.url).toBe('https://accounts.google.com/o/oauth2/v2/auth');

      const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requestUrl.pathname).toBe('/api/auth/oauth/google');
      expect(requestUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/dashboard',
      );
      expect(requestUrl.searchParams.get('code_challenge')).toHaveLength(43);
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
      expect(requestUrl.searchParams.get('login_hint')).toBe(
        'person@example.com',
      );
    });

    it('supports the deprecated object wrapper signature', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        }),
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager(),
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
      expect(requestUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/dashboard',
      );
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
    });

    it('does not let additionalParams override OAuth init fields', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        createJsonResponse(200, {
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        }),
      );
      const http = new HttpClient(
        {
          baseUrl: 'http://localhost:7130',
          fetch: fetchMock as any,
          retryCount: 0,
          timeout: 0,
        },
        new TokenManager(),
      );
      const auth = new Auth(http, new TokenManager(), { isServerMode: true });

      const { error } = await auth.signInWithOAuth(
        'google',
        {
          redirectTo: 'http://localhost:3000/dashboard',
          additionalParams: {
            redirect_uri: 'https://evil.example/callback',
            code_challenge: 'evil',
            prompt: 'select_account',
          },
          skipBrowserRedirect: true,
        },
      );

      expect(error).toBeNull();

      const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/dashboard',
      );
      expect(requestUrl.searchParams.get('code_challenge')).toHaveLength(43);
      expect(requestUrl.searchParams.get('code_challenge')).not.toBe('evil');
      expect(requestUrl.searchParams.get('prompt')).toBe('select_account');
      expect(requestUrl.searchParams.has('additionalParams[redirect_uri]')).toBe(
        false,
      );
      expect(requestUrl.searchParams.has('additionalParams[code_challenge]')).toBe(
        false,
      );
    });
  });
});
