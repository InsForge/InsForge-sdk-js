import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  accessTokenCookieOptions,
  clearAuthCookies,
  createBrowserClient,
  createRefreshAuthRouter,
  createServerClient,
  refreshAuth,
  refreshTokenCookieOptions,
  setAuthCookies,
  updateSession,
  type CookieOptions,
} from '../../ssr';
import { updateSession as updateSessionFromMiddleware } from '../middleware';

function jwtWithExp(exp: number): string {
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${payload}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cookieStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const options = new Map<string, CookieOptions>();
  return {
    get: vi.fn((name: string) => {
      const value = values.get(name);
      return value === undefined ? undefined : { name, value };
    }),
    set: vi.fn((name: string, value: string, opts?: CookieOptions) => {
      values.set(name, value);
      options.set(name, opts ?? {});
    }),
    delete: vi.fn((name: string) => {
      values.delete(name);
    }),
    values,
    options,
  };
}

type NextCookieOptions = Omit<CookieOptions, 'sameSite'> & {
  sameSite?: boolean | 'lax' | 'strict' | 'none';
};

class NextCookiesLike {
  public values = new Map<string, string>();
  public options = new Map<string, NextCookieOptions>();

  set(name: string, value: string, options?: NextCookieOptions): this;
  set(options: { name: string; value: string } & NextCookieOptions): this;
  set(
    nameOrOptions:
      | string
      | ({ name: string; value: string } & NextCookieOptions),
    value?: string,
    options?: NextCookieOptions,
  ): this {
    if (typeof nameOrOptions === 'string') {
      this.values.set(nameOrOptions, value ?? '');
      this.options.set(nameOrOptions, options ?? {});
      return this;
    }

    const { name, value: cookieValue, ...cookieOptions } = nameOrOptions;
    this.values.set(name, cookieValue);
    this.options.set(name, cookieOptions);
    return this;
  }

  delete(name: string): this;
  delete(options: { name: string } & NextCookieOptions): this;
  delete(nameOrOptions: string | ({ name: string } & NextCookieOptions)): this {
    const name =
      typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions.name;
    this.values.delete(name);
    return this;
  }
}

describe('@insforge/sdk/ssr cookies', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sets access cookies as browser-readable and expires at JWT exp', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = jwtWithExp(expiresAt);
    const options = accessTokenCookieOptions(token);

    expect(options.httpOnly).toBe(false);
    expect(options.path).toBe('/');
    expect(options.sameSite).toBe('lax');
    expect(options.expires?.getTime()).toBe(expiresAt * 1000);
  });

  it('sets refresh cookies as httpOnly and expires at JWT exp', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;
    const token = jwtWithExp(expiresAt);
    const options = refreshTokenCookieOptions(token);

    expect(options.httpOnly).toBe(true);
    expect(options.expires?.getTime()).toBe(expiresAt * 1000);
  });

  it('writes auth cookies through a NextResponse-like cookie wrapper', () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    const refreshToken = jwtWithExp(Math.floor(Date.now() / 1000) + 86400);
    const cookies = new NextCookiesLike();

    setAuthCookies(cookies, { accessToken, refreshToken });

    expect(cookies.values.get('insforge_access_token')).toBe(accessToken);
    expect(cookies.values.get('insforge_refresh_token')).toBe(refreshToken);
    expect(cookies.options.get('insforge_access_token')?.httpOnly).toBe(false);
    expect(cookies.options.get('insforge_refresh_token')?.httpOnly).toBe(true);
  });

  it('clears auth cookies through a NextResponse-like cookie wrapper', () => {
    const cookies = new NextCookiesLike();

    clearAuthCookies(cookies);

    expect(cookies.values.get('insforge_access_token')).toBe('');
    expect(cookies.values.get('insforge_refresh_token')).toBe('');
    expect(
      cookies.options.get('insforge_access_token')?.expires?.getTime(),
    ).toBe(0);
  });

  it('keeps deletion expiry fields when clearing cookies with overrides', () => {
    const cookies = new NextCookiesLike();

    clearAuthCookies(cookies, {
      options: {
        accessToken: {
          domain: 'app.test',
          expires: new Date('2030-01-01T00:00:00Z'),
          maxAge: 3600,
        },
      },
    });

    expect(cookies.options.get('insforge_access_token')).toMatchObject({
      domain: 'app.test',
      expires: new Date(0),
      maxAge: 0,
    });
  });

  it('creates a server client from the access-token cookie', () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const cookies = cookieStore({ insforge_access_token: token });

    const client = createServerClient({
      cookies,
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
    });

    expect(client.getHttpClient().getHeaders().Authorization).toBe(
      `Bearer ${token}`,
    );
  });

  it('creates a browser client from the access-token cookie', () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('document', {
      cookie: `insforge_access_token=${encodeURIComponent(token)}`,
    });

    const client = createBrowserClient({
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: vi.fn() as any,
    });

    expect(client.getHttpClient().getHeaders().Authorization).toBe(
      `Bearer ${token}`,
    );
  });

  it('refreshes through the app route before a browser request when access token is missing', async () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    vi.stubGlobal('document', { cookie: '' });
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, {
          accessToken,
          user: { id: 'user-1' },
        });
      }
      return jsonResponse(200, { ok: true, auth: init.headers });
    });

    const client = createBrowserClient({
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });
    const result = await client.getHttpClient().get('/api/protected');
    const protectedCall = fetch.mock.calls.find(
      ([url]: [string]) => url === 'https://api.insforge.test/api/protected',
    );

    expect(result).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new Headers(protectedCall?.[1]?.headers).get('Authorization')).toBe(
      `Bearer ${accessToken}`,
    );
  });

  it('refreshes through the app route and retries on AUTH_TOKEN_EXPIRED', async () => {
    const oldAccessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const freshAccessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    vi.stubGlobal('document', {
      cookie: `insforge_access_token=${encodeURIComponent(oldAccessToken)}`,
    });
    let protectedAttempts = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, {
          accessToken: freshAccessToken,
          user: { id: 'user-1' },
        });
      }

      protectedAttempts += 1;
      if (protectedAttempts === 1) {
        return jsonResponse(401, {
          error: ERROR_CODES.AUTH_TOKEN_EXPIRED,
          message: 'Access token expired',
          statusCode: 401,
        });
      }
      return jsonResponse(200, { ok: true });
    });

    const client = createBrowserClient({
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });
    const result = await client.getHttpClient().get('/api/protected');
    const protectedCalls = fetch.mock.calls.filter(
      ([url]: [string]) => url === 'https://api.insforge.test/api/protected',
    );

    expect(result).toEqual({ ok: true });
    expect(protectedCalls).toHaveLength(2);
    expect(new Headers(protectedCalls[0][1].headers).get('Authorization')).toBe(
      `Bearer ${oldAccessToken}`,
    );
    expect(new Headers(protectedCalls[1][1].headers).get('Authorization')).toBe(
      `Bearer ${freshAccessToken}`,
    );
    expect(
      fetch.mock.calls.some(
        ([url]: [string]) =>
          url === 'https://api.insforge.test/api/auth/refresh',
      ),
    ).toBe(false);
  });

  it('detects the refresh route when the SSR fetch receives a Request input', async () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal('document', {
      cookie: `insforge_access_token=${encodeURIComponent(accessToken)}`,
    });
    const fetch = vi.fn(async () =>
      jsonResponse(401, {
        error: ERROR_CODES.AUTH_TOKEN_EXPIRED,
        message: 'Access token expired',
        statusCode: 401,
      }),
    );

    const client = createBrowserClient({
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });
    const response = await client
      .getHttpClient()
      .fetch(new Request('https://app.test/api/auth/refresh'));

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('@insforge/sdk/ssr/middleware entrypoint', () => {
  it('exports the proxy-safe updateSession helper', () => {
    expect(updateSessionFromMiddleware).toBe(updateSession);
  });
});

describe('@insforge/sdk/ssr config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses public env defaults for browser clients', () => {
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'https://public.insforge.test');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'public-anon-key');
    vi.stubGlobal('document', { cookie: '' });

    const client = createBrowserClient({
      fetch: vi.fn() as any,
    });

    expect(client.getHttpClient().baseUrl).toBe('https://public.insforge.test');
  });

  it('uses explicit browser config when process is unavailable', () => {
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('document', { cookie: '' });

    const client = createBrowserClient({
      baseUrl: 'https://explicit.insforge.test',
      anonKey: 'explicit-anon-key',
      fetch: vi.fn() as any,
    });

    expect(client.getHttpClient().baseUrl).toBe(
      'https://explicit.insforge.test',
    );
  });

  it('uses public env defaults for server clients', () => {
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'https://public.insforge.test');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'public-anon-key');

    const client = createServerClient();

    expect(client.getHttpClient().baseUrl).toBe('https://public.insforge.test');
  });

  it('throws when SSR browser config cannot resolve baseUrl', () => {
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'public-anon-key');
    vi.stubGlobal('document', { cookie: '' });

    expect(() =>
      createBrowserClient({
        fetch: vi.fn() as any,
      }),
    ).toThrow('NEXT_PUBLIC_INSFORGE_URL');
  });

  it('throws when SSR server config cannot resolve anonKey', () => {
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'https://public.insforge.test');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_ANON_KEY', '');

    expect(() => createServerClient()).toThrow('NEXT_PUBLIC_INSFORGE_ANON_KEY');
  });
});

describe('@insforge/sdk/ssr refresh route', () => {
  it('returns AUTH_UNAUTHORIZED when refresh token cookie is missing', async () => {
    const result = await refreshAuth({
      request: new Request('https://app.test/api/auth/refresh', {
        method: 'POST',
      }),
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: vi.fn() as any,
    });
    const body = await result.response.json();

    expect(result.error?.error).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
    expect(result.response.status).toBe(401);
    expect(body.error).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
  });

  it('refreshes with the httpOnly refresh cookie and returns access token only', async () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    const refreshToken = jwtWithExp(Math.floor(Date.now() / 1000) + 86400);
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(
        'https://api.insforge.test/api/auth/refresh?client_type=mobile',
      );
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'Bearer anon-key',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        refresh_token: 'old-refresh',
      });
      return jsonResponse(200, {
        accessToken,
        refreshToken,
        user: { id: 'user-1' },
      });
    });
    const request = new Request('https://app.test/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: 'insforge_refresh_token=old-refresh' },
    });

    const result = await refreshAuth({
      request,
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });
    const body = await result.response.json();
    const setCookies = result.response.headers.getSetCookie();

    expect(result.error).toBeNull();
    expect(body.accessToken).toBe(accessToken);
    expect(body.refreshToken).toBeUndefined();
    expect(setCookies.some((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith('insforge_access_token=') &&
          !cookie.includes('HttpOnly'),
      ),
    ).toBe(true);
  });

  it('creates a POST route handler', async () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        accessToken,
        user: { id: 'user-1' },
      }),
    );
    const { POST } = createRefreshAuthRouter({
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });

    const response = await POST(
      new Request('https://app.test/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'insforge_refresh_token=old-refresh' },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).accessToken).toBe(accessToken);
  });
});

describe('@insforge/sdk/ssr updateSession', () => {
  it('does not write cookies for fully anonymous requests', async () => {
    const requestCookies = cookieStore();
    const responseCookies = cookieStore();

    const result = await updateSession({
      requestCookies,
      responseCookies,
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: vi.fn() as any,
    });

    expect(result).toEqual({
      refreshed: false,
      accessToken: null,
      error: null,
    });
    expect(requestCookies.set).not.toHaveBeenCalled();
    expect(responseCookies.set).not.toHaveBeenCalled();
    expect(requestCookies.delete).not.toHaveBeenCalled();
    expect(responseCookies.delete).not.toHaveBeenCalled();
  });

  it('does not refresh when access token is still fresh', async () => {
    const accessToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const requestCookies = cookieStore({ insforge_access_token: accessToken });
    const responseCookies = cookieStore();
    const fetch = vi.fn();

    const result = await updateSession({
      requestCookies,
      responseCookies,
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });

    expect(result).toEqual({
      refreshed: false,
      accessToken,
      error: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes expired access token and writes request and response cookies', async () => {
    const expiredAccess = jwtWithExp(Math.floor(Date.now() / 1000) - 10);
    const freshAccess = jwtWithExp(Math.floor(Date.now() / 1000) + 900);
    const freshRefresh = jwtWithExp(Math.floor(Date.now() / 1000) + 86400);
    const requestCookies = cookieStore({
      insforge_access_token: expiredAccess,
      insforge_refresh_token: 'old-refresh',
    });
    const responseCookies = cookieStore();
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        accessToken: freshAccess,
        refreshToken: freshRefresh,
        user: { id: 'user-1' },
      }),
    );

    const result = await updateSession({
      requestCookies,
      responseCookies,
      baseUrl: 'https://api.insforge.test',
      anonKey: 'anon-key',
      fetch: fetch as any,
    });

    expect(result.refreshed).toBe(true);
    expect(result.accessToken).toBe(freshAccess);
    expect(requestCookies.values.get('insforge_access_token')).toBe(
      freshAccess,
    );
    expect(responseCookies.values.get('insforge_access_token')).toBe(
      freshAccess,
    );
    expect(
      responseCookies.options.get('insforge_refresh_token')?.httpOnly,
    ).toBe(true);
  });
});
