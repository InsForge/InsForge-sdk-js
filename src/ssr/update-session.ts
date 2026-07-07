import { isJwtExpiredOrExpiring } from '../lib/jwt';
import type { InsForgeConfig, InsForgeError } from '../types';
import {
  clearAuthCookies,
  getAccessTokenCookieName,
  getCookieValue,
  getRefreshTokenCookieName,
  setAuthCookies,
  type AuthCookieSettings,
  type CookieStore,
} from './cookies';
import { refreshAuth } from './refresh';

export interface UpdateSessionOptions
  extends
    Omit<InsForgeConfig, 'accessToken' | 'edgeFunctionToken' | 'isServerMode' | 'auth'>,
    AuthCookieSettings {
  requestCookies: CookieStore;
  responseCookies: CookieStore;
  refreshLeewaySeconds?: number;
}

export interface UpdateSessionResult {
  refreshed: boolean;
  accessToken: string | null;
  error: InsForgeError | null;
}

export async function updateSession(options: UpdateSessionOptions): Promise<UpdateSessionResult> {
  const accessCookieName = getAccessTokenCookieName(options.names);
  const refreshCookieName = getRefreshTokenCookieName(options.names);
  const accessToken = getCookieValue(options.requestCookies, accessCookieName);

  if (accessToken && !isJwtExpiredOrExpiring(accessToken, options.refreshLeewaySeconds)) {
    return {
      refreshed: false,
      accessToken,
      error: null,
    };
  }

  const refreshToken = getCookieValue(options.requestCookies, refreshCookieName);
  if (!refreshToken) {
    if (accessToken) {
      clearAuthCookies(options.requestCookies, options);
      clearAuthCookies(options.responseCookies, options);
    }
    return {
      refreshed: false,
      accessToken: null,
      error: null,
    };
  }

  const result = await refreshAuth({
    ...options,
    refreshToken,
  });

  if (result.error || !result.accessToken) {
    clearAuthCookies(options.requestCookies, options);
    clearAuthCookies(options.responseCookies, options);
    return {
      refreshed: false,
      accessToken: null,
      error: result.error,
    };
  }

  const tokens = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? refreshToken,
  };
  setAuthCookies(options.requestCookies, tokens, options);
  setAuthCookies(options.responseCookies, tokens, options);

  return {
    refreshed: true,
    accessToken: result.accessToken,
    error: null,
  };
}
