import { InsForgeClient } from '../client';
import { InsForgeError, type AuthRefreshResponse } from '../types';
import { resolveServerConfig, type SsrClientConfig } from './config';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  clearAuthCookies,
  getCookieValue,
  getCookieValueFromHeader,
  getRefreshTokenCookieName,
  setAuthCookies,
  type AuthCookieSettings,
  type CookieStore,
} from './cookies';

export interface RefreshAuthOptions
  extends SsrClientConfig,
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

  return new InsForgeError(
    error instanceof Error ? error.message : 'Failed to refresh auth session',
    500,
    ERROR_CODES.UNKNOWN_ERROR,
  );
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
    clearAuthCookies(headers, options);
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

  const client = new InsForgeClient({
    ...resolveServerConfig(options),
    isServerMode: true,
  });
  const { data, error } = await client.auth.refreshSession({ refreshToken });

  if (error || !data?.accessToken) {
    clearAuthCookies(headers, options);
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
  setAuthCookies(
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
