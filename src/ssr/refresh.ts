import {
  InsForgeError,
  type AuthRefreshResponse,
  type InsForgeConfig,
} from '../types';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  clearAuthCookieHeaders,
  getCookieValue,
  getCookieValueFromHeader,
  getRefreshTokenCookieName,
  setAuthCookieHeaders,
  type AuthCookieSettings,
  type CookieStore,
} from './cookies';

export interface RefreshAuthOptions
  extends Omit<InsForgeConfig, 'edgeFunctionToken' | 'isServerMode' | 'auth'>,
    AuthCookieSettings {
  request?: Request;
  cookies?: Pick<CookieStore, 'get'>;
  refreshToken?: string;
}

export interface RefreshAuthResult {
  response: Response;
  data: AuthRefreshResponse | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: InsForgeError | null;
}

export type RefreshAuthRouteHandler = (request: Request) => Promise<Response>;

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
  headers = new Headers(init.headers),
): Response {
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function normalizeError(error: unknown): InsForgeError {
  if (error instanceof InsForgeError) return error;

  if (error && typeof error === 'object') {
    const body = error as {
      error?: unknown;
      message?: unknown;
      statusCode?: unknown;
    };
    return new InsForgeError(
      typeof body.message === 'string'
        ? body.message
        : 'Failed to refresh auth session',
      typeof body.statusCode === 'number' ? body.statusCode : 500,
      typeof body.error === 'string'
        ? body.error
        : ERROR_CODES.UNKNOWN_ERROR,
    );
  }

  return new InsForgeError(
    error instanceof Error ? error.message : 'Failed to refresh auth session',
    500,
    ERROR_CODES.UNKNOWN_ERROR,
  );
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('json')) return null;
  return response.json();
}

function readRefreshToken(options: RefreshAuthOptions): string | null {
  if (options.refreshToken) return options.refreshToken;

  const refreshCookieName = getRefreshTokenCookieName(options.names);
  const cookieValue = getCookieValue(options.cookies, refreshCookieName);
  if (cookieValue) return cookieValue;

  return getCookieValueFromHeader(
    options.request?.headers.get('cookie'),
    refreshCookieName,
  );
}

export async function refreshAuth(
  options: RefreshAuthOptions = {},
): Promise<RefreshAuthResult> {
  const headers = new Headers();
  const refreshToken = readRefreshToken(options);

  if (!refreshToken) {
    clearAuthCookieHeaders(headers, options);
    const error = new InsForgeError(
      'Refresh token cookie is missing',
      401,
      ERROR_CODES.AUTH_UNAUTHORIZED,
    );
    return {
      response: jsonResponse(
        {
          error: error.error,
          message: error.message,
          statusCode: error.statusCode,
        },
        { status: error.statusCode },
        headers,
      ),
      data: null,
      accessToken: null,
      refreshToken: null,
      error,
    };
  }

  let { baseUrl, anonKey } = options;
  try {
    baseUrl ||= process.env.NEXT_PUBLIC_INSFORGE_URL;
    anonKey ||= process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  } catch {
    // process may be unavailable outside Next.js/browser-bundled envs.
  }
  if (!baseUrl || !anonKey) {
    throw new Error(
      'Missing InsForge baseUrl or anonKey. Pass baseUrl and anonKey to refreshAuth() or set NEXT_PUBLIC_INSFORGE_URL and NEXT_PUBLIC_INSFORGE_ANON_KEY.',
    );
  }

  const fetchImpl =
    options.fetch ??
    (globalThis.fetch
      ? globalThis.fetch.bind(globalThis)
      : (undefined as typeof fetch | undefined));
  if (!fetchImpl) {
    throw new Error(
      'Fetch is not available. Please provide a fetch implementation.',
    );
  }

  const requestHeaders = new Headers(options.headers);
  requestHeaders.set('Authorization', `Bearer ${anonKey}`);
  requestHeaders.set('Content-Type', 'application/json');
  requestHeaders.set('Accept', 'application/json');

  let data: AuthRefreshResponse | null = null;
  let error: InsForgeError | null = null;

  try {
    const response = await fetchImpl(
      new URL('/api/auth/refresh?client_type=mobile', baseUrl).toString(),
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    const body = await readJson(response);
    if (!response.ok) {
      error = normalizeError(
        body ?? {
          message: 'Failed to refresh auth session',
          statusCode: response.status,
          error: ERROR_CODES.UNKNOWN_ERROR,
        },
      );
    } else {
      data = body as AuthRefreshResponse;
    }
  } catch (caught) {
    error = normalizeError(caught);
  }

  if (error || !data?.accessToken) {
    clearAuthCookieHeaders(headers, options);
    const normalized = normalizeError(error);
    return {
      response: jsonResponse(
        {
          error: normalized.error,
          message: normalized.message,
          statusCode: normalized.statusCode,
        },
        { status: normalized.statusCode || 500 },
        headers,
      ),
      data: null,
      accessToken: null,
      refreshToken: null,
      error: normalized,
    };
  }

  const nextRefreshToken = data.refreshToken ?? refreshToken;
  setAuthCookieHeaders(
    headers,
    {
      accessToken: data.accessToken,
      refreshToken: nextRefreshToken,
    },
    options,
  );

  const responseBody: AuthRefreshResponse = {
    accessToken: data.accessToken,
    user: data.user,
    csrfToken: data.csrfToken,
  };

  return {
    response: jsonResponse(responseBody, { status: 200 }, headers),
    data: responseBody,
    accessToken: data.accessToken,
    refreshToken: nextRefreshToken,
    error: null,
  };
}

export function createRefreshAuthRouter(
  options: Omit<RefreshAuthOptions, 'request'> = {},
): { POST: RefreshAuthRouteHandler } {
  return {
    POST: async (request: Request) =>
      (await refreshAuth({ ...options, request })).response,
  };
}
