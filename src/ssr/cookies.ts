import { getJwtExpiration } from '../lib/jwt';

export const DEFAULT_ACCESS_TOKEN_COOKIE = 'insforge_access_token';
export const DEFAULT_REFRESH_TOKEN_COOKIE = 'insforge_refresh_token';

export interface AuthCookieNames {
  accessToken?: string;
  refreshToken?: string;
}

export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
}

export interface AuthCookieOptions {
  accessToken?: CookieOptions;
  refreshToken?: CookieOptions;
}

export type CookieStoreValue =
  | string
  | { value?: string | null }
  | undefined
  | null;

export interface CookieStore {
  get(name: string): CookieStoreValue;
  set?(name: string, value: string, options?: CookieOptions): unknown;
  delete?(name: string, options?: CookieOptions): unknown;
}

export interface AuthCookieSettings {
  names?: AuthCookieNames;
  options?: AuthCookieOptions;
}

const EXPIRED_DATE = new Date(0);

export function getAccessTokenCookieName(names?: AuthCookieNames): string {
  return names?.accessToken ?? DEFAULT_ACCESS_TOKEN_COOKIE;
}

export function getRefreshTokenCookieName(names?: AuthCookieNames): string {
  return names?.refreshToken ?? DEFAULT_REFRESH_TOKEN_COOKIE;
}

export function getCookieValue(
  cookies: Pick<CookieStore, 'get'> | undefined,
  name: string,
): string | null {
  if (!cookies) return null;

  const value = cookies.get(name);
  if (typeof value === 'string') return value || null;
  if (value && typeof value.value === 'string') return value.value || null;
  return null;
}

export function getCookieValueFromHeader(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return rawValue.join('=');
    }
  }
  return null;
}

export function getBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return getCookieValueFromHeader(document.cookie, name);
}

function defaultCookieOptions(): CookieOptions {
  const secure =
    typeof process !== 'undefined'
      ? process.env.NODE_ENV === 'production'
      : typeof location !== 'undefined' && location.protocol === 'https:';

  return {
    path: '/',
    sameSite: 'lax',
    secure,
  };
}

export function accessTokenCookieOptions(
  token: string,
  overrides?: CookieOptions,
): CookieOptions {
  return {
    ...defaultCookieOptions(),
    httpOnly: false,
    expires: getJwtExpiration(token) ?? undefined,
    ...overrides,
  };
}

export function refreshTokenCookieOptions(
  token: string,
  overrides?: CookieOptions,
): CookieOptions {
  return {
    ...defaultCookieOptions(),
    httpOnly: true,
    expires: getJwtExpiration(token) ?? undefined,
    ...overrides,
  };
}

export function expiredCookieOptions(overrides?: CookieOptions): CookieOptions {
  return {
    ...defaultCookieOptions(),
    expires: EXPIRED_DATE,
    maxAge: 0,
    ...overrides,
  };
}

export function setCookie(
  cookies: Pick<CookieStore, 'set'> | undefined,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  if (!cookies?.set) return;
  cookies.set(name, value, options);
}

export function deleteCookie(
  cookies: Pick<CookieStore, 'set' | 'delete'> | undefined,
  name: string,
  options?: CookieOptions,
): void {
  if (!cookies) return;
  if (cookies.delete) {
    cookies.delete(name, options);
    return;
  }
  cookies.set?.(name, '', expiredCookieOptions(options));
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    const sameSite =
      options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
    parts.push(`SameSite=${sameSite}`);
  }

  return parts.join('; ');
}

export function appendSetCookie(
  headers: Headers,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  headers.append('Set-Cookie', serializeCookie(name, value, options));
}

export function setAuthCookies(
  target: Headers | CookieStore | undefined,
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
  },
  settings: AuthCookieSettings = {},
): void {
  const accessName = getAccessTokenCookieName(settings.names);
  const refreshName = getRefreshTokenCookieName(settings.names);
  const accessOptions = accessTokenCookieOptions(
    tokens.accessToken,
    settings.options?.accessToken,
  );

  if (target instanceof Headers) {
    appendSetCookie(target, accessName, tokens.accessToken, accessOptions);
    if (tokens.refreshToken) {
      appendSetCookie(
        target,
        refreshName,
        tokens.refreshToken,
        refreshTokenCookieOptions(
          tokens.refreshToken,
          settings.options?.refreshToken,
        ),
      );
    }
    return;
  }

  setCookie(target, accessName, tokens.accessToken, accessOptions);
  if (tokens.refreshToken) {
    setCookie(
      target,
      refreshName,
      tokens.refreshToken,
      refreshTokenCookieOptions(
        tokens.refreshToken,
        settings.options?.refreshToken,
      ),
    );
  }
}

export function clearAuthCookies(
  target: Headers | CookieStore | undefined,
  settings: AuthCookieSettings = {},
): void {
  const accessName = getAccessTokenCookieName(settings.names);
  const refreshName = getRefreshTokenCookieName(settings.names);
  const accessOptions = expiredCookieOptions(settings.options?.accessToken);
  const refreshOptions = expiredCookieOptions(settings.options?.refreshToken);

  if (target instanceof Headers) {
    appendSetCookie(target, accessName, '', accessOptions);
    appendSetCookie(target, refreshName, '', refreshOptions);
    return;
  }

  deleteCookie(target, accessName, accessOptions);
  deleteCookie(target, refreshName, refreshOptions);
}
