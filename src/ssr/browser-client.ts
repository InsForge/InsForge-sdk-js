import { InsForgeClient } from '../client';
import {
  InsForgeError,
  type AuthRefreshResponse,
  type InsForgeConfig,
} from '../types';
import { isJwtExpiredOrExpiring } from '../lib/jwt';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  getAccessTokenCookieName,
  getBrowserCookie,
  type AuthCookieSettings,
} from './cookies';

export interface CreateBrowserClientOptions
  extends Omit<InsForgeConfig, 'edgeFunctionToken' | 'isServerMode' | 'auth'>,
    AuthCookieSettings {
  refreshUrl?: string;
  refreshLeewaySeconds?: number;
}

async function parseRefreshResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('json')) {
    return await response.json();
  }
  return await response.text();
}

function toRefreshError(response: Response, body: unknown): InsForgeError {
  if (body && typeof body === 'object') {
    const errorBody = body as {
      error?: unknown;
      message?: unknown;
      statusCode?: unknown;
    };
    return new InsForgeError(
      typeof errorBody.message === 'string'
        ? errorBody.message
        : 'Failed to refresh auth session',
      typeof errorBody.statusCode === 'number'
        ? errorBody.statusCode
        : response.status,
      typeof errorBody.error === 'string'
        ? errorBody.error
        : ERROR_CODES.UNKNOWN_ERROR,
    );
  }

  return new InsForgeError(
    typeof body === 'string' && body
      ? body
      : 'Failed to refresh auth session',
    response.status,
    ERROR_CODES.UNKNOWN_ERROR,
  );
}

async function readErrorCode(response: Response): Promise<string | null> {
  if (response.status !== 401) return null;

  try {
    const body = await response.clone().json();
    if (!body || typeof body !== 'object') return null;
    const candidate =
      (body as { error?: unknown; code?: unknown }).error ??
      (body as { code?: unknown }).code;
    return typeof candidate === 'string' ? candidate : null;
  } catch {
    return null;
  }
}

function isRefreshableErrorCode(code: string | null): boolean {
  return (
    code === ERROR_CODES.AUTH_UNAUTHORIZED ||
    code === ERROR_CODES.AUTH_TOKEN_EXPIRED ||
    code === 'PGRST301'
  );
}

function withAuthHeader(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return {
    ...init,
    headers,
  };
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return input.toString();
}

export function createBrowserClient(
  options: CreateBrowserClientOptions = {},
): InsForgeClient {
  let { baseUrl, anonKey } = options;
  try {
    baseUrl ||= process.env.NEXT_PUBLIC_INSFORGE_URL;
    anonKey ||= process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  } catch {
    // process may be unavailable outside Next.js/browser-bundled envs.
  }
  if (!baseUrl || !anonKey) {
    throw new Error(
      'Missing InsForge baseUrl or anonKey. Pass baseUrl and anonKey to createBrowserClient() or set NEXT_PUBLIC_INSFORGE_URL and NEXT_PUBLIC_INSFORGE_ANON_KEY.',
    );
  }

  let accessToken = getBrowserCookie(
    getAccessTokenCookieName(options.names),
  );
  const refreshUrl = options.refreshUrl ?? '/api/auth/refresh';
  const fetchImpl =
    options.fetch ??
    (globalThis.fetch
      ? globalThis.fetch.bind(globalThis)
      : (undefined as typeof fetch | undefined));
  let client: InsForgeClient;
  let sessionChecked = false;
  let refreshPromise: Promise<AuthRefreshResponse | null> | null = null;

  const refreshFromRoute = (): Promise<AuthRefreshResponse | null> => {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      if (!fetchImpl) {
        throw new Error(
          'Fetch is not available. Please provide a fetch implementation.',
        );
      }

      const response = await fetchImpl(refreshUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await parseRefreshResponse(response);

      if (!response.ok) {
        const error = toRefreshError(response, body);
        if (
          response.status === 401 &&
          (error.error === ERROR_CODES.AUTH_UNAUTHORIZED ||
            error.error === ERROR_CODES.AUTH_TOKEN_EXPIRED)
        ) {
          accessToken = null;
          client?.setAccessToken(null);
          return null;
        }
        throw error;
      }

      if (!body || typeof body !== 'object') return null;
      const refreshBody = body as Partial<AuthRefreshResponse>;
      if (!refreshBody.accessToken || !refreshBody.user) return null;

      accessToken = refreshBody.accessToken;
      client?.setAccessToken(refreshBody.accessToken);
      return refreshBody as AuthRefreshResponse;
    })().finally(() => {
      sessionChecked = true;
      refreshPromise = null;
    });

    return refreshPromise;
  };

  const shouldSkipRefresh = (input: RequestInfo | URL): boolean => {
    const url = getRequestUrl(input);
    return url === refreshUrl || url.endsWith(refreshUrl);
  };

  const ssrFetch: typeof fetch = async (input, init) => {
    if (!fetchImpl) {
      throw new Error(
        'Fetch is not available. Please provide a fetch implementation.',
      );
    }
    if (shouldSkipRefresh(input)) {
      return fetchImpl(input, init);
    }

    let requestInit = init;
    if (
      (!accessToken && !sessionChecked) ||
      isJwtExpiredOrExpiring(accessToken, options.refreshLeewaySeconds)
    ) {
      const refreshed = await refreshFromRoute().catch(() => null);
      if (refreshed?.accessToken) {
        requestInit = withAuthHeader(init, refreshed.accessToken);
      }
    }

    const response = await fetchImpl(input, requestInit);
    const errorCode = await readErrorCode(response);
    if (!isRefreshableErrorCode(errorCode)) {
      return response;
    }

    const refreshed = await refreshFromRoute();
    if (!refreshed?.accessToken) {
      client.setAccessToken(null);
      return response;
    }

    return fetchImpl(input, withAuthHeader(init, refreshed.accessToken));
  };

  client = new InsForgeClient({
    ...options,
    baseUrl,
    anonKey,
    fetch: ssrFetch,
  });
  const setAccessToken = client.setAccessToken.bind(client);
  client.setAccessToken = (token: string | null) => {
    accessToken = token;
    setAccessToken(token);
  };

  if (accessToken) {
    client.setAccessToken(accessToken);
  }

  if (
    !accessToken ||
    isJwtExpiredOrExpiring(accessToken, options.refreshLeewaySeconds)
  ) {
    void refreshFromRoute().catch(() => undefined);
  }

  return client;
}
