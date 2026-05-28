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

export interface CookieReader {
  get(name: string): CookieStoreValue;
}

export interface CookieWriter {
  set?(name: string, value: string, options?: CookieOptions): unknown;
  set?(options: { name: string; value: string } & CookieOptions): unknown;
  delete?(name: string): unknown;
  delete?(options: { name: string } & CookieOptions): unknown;
}

export interface CookieStore extends CookieReader, CookieWriter {}

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
  cookies: CookieReader | undefined,
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
  const { expires: _expires, maxAge: _maxAge, ...safeOverrides } = overrides ?? {};
  return {
    ...defaultCookieOptions(),
    ...safeOverrides,
    expires: EXPIRED_DATE,
    maxAge: 0,
  };
}

export function setCookie(
  cookies: CookieWriter | undefined,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  if (!cookies?.set) return;
  cookies.set(name, value, options);
}

export function deleteCookie(
  cookies: CookieWriter | undefined,
  name: string,
  options?: CookieOptions,
): void {
  if (!cookies) return;
  if (cookies.set) {
    cookies.set(name, '', expiredCookieOptions(options));
    return;
  }
  cookies.delete?.(name);
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
  cookies: CookieWriter | undefined,
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

  setCookie(cookies, accessName, tokens.accessToken, accessOptions);
  if (tokens.refreshToken) {
    setCookie(
      cookies,
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
  cookies: CookieWriter | undefined,
  settings: AuthCookieSettings = {},
): void {
  const accessName = getAccessTokenCookieName(settings.names);
  const refreshName = getRefreshTokenCookieName(settings.names);
  const accessOptions = expiredCookieOptions(settings.options?.accessToken);
  const refreshOptions = expiredCookieOptions(settings.options?.refreshToken);

  deleteCookie(cookies, accessName, accessOptions);
  deleteCookie(cookies, refreshName, refreshOptions);
}

export function setAuthCookieHeaders(
  headers: Headers,
  tokens: {
    accessToken: string;
    refreshToken?: string | null;
  },
  settings: AuthCookieSettings = {},
): void {
  const accessName = getAccessTokenCookieName(settings.names);
  const refreshName = getRefreshTokenCookieName(settings.names);

  appendSetCookie(
    headers,
    accessName,
    tokens.accessToken,
    accessTokenCookieOptions(tokens.accessToken, settings.options?.accessToken),
  );
  if (tokens.refreshToken) {
    appendSetCookie(
      headers,
      refreshName,
      tokens.refreshToken,
      refreshTokenCookieOptions(
        tokens.refreshToken,
        settings.options?.refreshToken,
      ),
    );
  }
}

export function clearAuthCookieHeaders(
  headers: Headers,
  settings: AuthCookieSettings = {},
): void {
  appendSetCookie(
    headers,
    getAccessTokenCookieName(settings.names),
    '',
    expiredCookieOptions(settings.options?.accessToken),
  );
  appendSetCookie(
    headers,
    getRefreshTokenCookieName(settings.names),
    '',
    expiredCookieOptions(settings.options?.refreshToken),
  );
}
