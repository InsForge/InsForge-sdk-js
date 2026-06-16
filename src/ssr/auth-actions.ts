import { InsForgeClient } from '../client';
import type { InsForgeConfig } from '../types';
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

export interface AuthActions {
  signUp: InsForgeClient['auth']['signUp'];
  signInWithPassword: InsForgeClient['auth']['signInWithPassword'];
  signInWithIdToken: InsForgeClient['auth']['signInWithIdToken'];
  exchangeOAuthCode: InsForgeClient['auth']['exchangeOAuthCode'];
  verifyEmail: InsForgeClient['auth']['verifyEmail'];
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
      return result;
    },

    signInWithPassword: async (request) => {
      const result = await createClient().auth.signInWithPassword(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return result;
    },

    signInWithIdToken: async (credentials) => {
      const result = await createClient().auth.signInWithIdToken(credentials);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return result;
    },

    exchangeOAuthCode: async (code, codeVerifier) => {
      const result = await createClient().auth.exchangeOAuthCode(
        code,
        codeVerifier,
      );
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return result;
    },

    verifyEmail: async (request) => {
      const result = await createClient().auth.verifyEmail(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return result;
    },

    signOut: async () => {
      const result = await createClient().auth.signOut();
      clearAuthCookies(writeCookies, cookieSettings);
      return result;
    },
  };
}
