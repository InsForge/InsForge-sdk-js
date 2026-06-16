import { InsForgeClient } from '../client';
import type { InsForgeConfig, InsForgeError } from '../types';
import { createServerClient } from './server-client';
import {
  clearAuthCookies,
  setAuthCookies,
  type AuthCookieSettings,
  type CookieStore,
  type CookieWriter,
} from './cookies';

export interface CreateAuthActionsOptions
  extends Omit<
      InsForgeConfig,
      'accessToken' | 'edgeFunctionToken' | 'isServerMode' | 'auth'
    >,
    AuthCookieSettings {
  /**
   * Read/write cookie store. Use this in Next.js Server Actions:
   * `createAuthActions({ cookies: await cookies() })`.
   */
  cookies?: CookieStore;

  /**
   * Request cookie reader. Use with `responseCookies` in Route Handlers where
   * request and response cookies are separate objects.
   */
  requestCookies?: Pick<CookieStore, 'get'>;

  /**
   * Response cookie writer. Use with `requestCookies` in Route Handlers.
   */
  responseCookies?: CookieWriter;
}

type AuthTokenKeys = 'accessToken' | 'refreshToken' | 'csrfToken';
type SafeAuthData<T> = Omit<NonNullable<T>, AuthTokenKeys>;
type AuthResultData<TMethod extends (...args: any[]) => Promise<any>> =
  Awaited<ReturnType<TMethod>> extends { data: infer TData } ? TData : never;
type SafeAuthAction<TMethod extends (...args: any[]) => Promise<any>> = (
  ...args: Parameters<TMethod>
) => Promise<{
  data: SafeAuthData<AuthResultData<TMethod>> | null;
  error: InsForgeError | null;
}>;

export interface AuthActions {
  signUp: SafeAuthAction<InsForgeClient['auth']['signUp']>;
  signInWithPassword: SafeAuthAction<
    InsForgeClient['auth']['signInWithPassword']
  >;
  signInWithOAuth: InsForgeClient['auth']['signInWithOAuth'];
  signInWithIdToken: SafeAuthAction<InsForgeClient['auth']['signInWithIdToken']>;
  exchangeOAuthCode: SafeAuthAction<InsForgeClient['auth']['exchangeOAuthCode']>;
  verifyEmail: SafeAuthAction<InsForgeClient['auth']['verifyEmail']>;
  signOut: InsForgeClient['auth']['signOut'];
}

function persistSessionCookies(
  cookies: CookieWriter | undefined,
  data: { accessToken?: string | null; refreshToken?: string | null } | null,
  settings: AuthCookieSettings,
): void {
  if (!data?.accessToken) return;

  setAuthCookies(
    cookies,
    {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    },
    settings,
  );
}

function sanitizeAuthData<T>(
  data: T | null,
): SafeAuthData<T> | null {
  if (!data) return null;

  const {
    accessToken: _accessToken,
    refreshToken: _refreshToken,
    csrfToken: _csrfToken,
    ...safeData
  } = data as Record<string, unknown>;

  return safeData as SafeAuthData<T>;
}

function toSafeAuthResult<TMethod extends (...args: any[]) => Promise<any>>(
  result: Awaited<ReturnType<TMethod>>,
): Awaited<ReturnType<SafeAuthAction<TMethod>>> {
  return {
    data: sanitizeAuthData(result.data),
    error: result.error,
  };
}

export function createAuthActions(
  options: CreateAuthActionsOptions = {},
): AuthActions {
  const {
    cookies,
    requestCookies,
    responseCookies,
    names,
    options: cookieOptions,
    ...clientOptions
  } = options;
  const readCookies = requestCookies ?? cookies;
  const writeCookies = responseCookies ?? cookies;
  if (!writeCookies?.set) {
    throw new Error(
      'createAuthActions() requires a writable cookie store. Pass cookies in Server Actions or responseCookies in Route Handlers.',
    );
  }

  const cookieSettings: AuthCookieSettings = {
    names,
    options: cookieOptions,
  };

  const createClient = () =>
    createServerClient({
      ...clientOptions,
      names,
      options: cookieOptions,
      cookies: readCookies,
    });

  return {
    signUp: async (request) => {
      const result = await createClient().auth.signUp(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['signUp']>(result);
    },

    signInWithPassword: async (request) => {
      const result = await createClient().auth.signInWithPassword(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['signInWithPassword']>(
        result,
      );
    },

    signInWithOAuth: async (providerOrOptions: any, signInOptions?: any) => {
      return createClient().auth.signInWithOAuth(
        providerOrOptions,
        signInOptions,
      );
    },

    signInWithIdToken: async (credentials) => {
      const result = await createClient().auth.signInWithIdToken(credentials);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['signInWithIdToken']>(
        result,
      );
    },

    exchangeOAuthCode: async (code, codeVerifier) => {
      const result = await createClient().auth.exchangeOAuthCode(
        code,
        codeVerifier,
      );
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['exchangeOAuthCode']>(
        result,
      );
    },

    verifyEmail: async (request) => {
      const result = await createClient().auth.verifyEmail(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['verifyEmail']>(result);
    },

    signOut: async () => {
      const result = await createClient().auth.signOut();
      clearAuthCookies(writeCookies, cookieSettings);
      return result;
    },
  };
}
