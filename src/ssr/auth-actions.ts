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
  extends
    Omit<InsForgeConfig, 'accessToken' | 'edgeFunctionToken' | 'isServerMode' | 'auth'>,
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
  signInWithPassword: SafeAuthAction<InsForgeClient['auth']['signInWithPassword']>;
  signInWithOAuth: InsForgeClient['auth']['signInWithOAuth'];
  signInWithIdToken: SafeAuthAction<InsForgeClient['auth']['signInWithIdToken']>;
  exchangeOAuthCode: SafeAuthAction<InsForgeClient['auth']['exchangeOAuthCode']>;
  resendVerificationEmail: InsForgeClient['auth']['resendVerificationEmail'];
  verifyEmail: SafeAuthAction<InsForgeClient['auth']['verifyEmail']>;
  signInWithOtp: InsForgeClient['auth']['signInWithOtp'];
  verifyOtp: SafeAuthAction<InsForgeClient['auth']['verifyOtp']>;
  sendResetPasswordEmail: InsForgeClient['auth']['sendResetPasswordEmail'];
  exchangeResetPasswordToken: InsForgeClient['auth']['exchangeResetPasswordToken'];
  resetPassword: InsForgeClient['auth']['resetPassword'];
  signOut: InsForgeClient['auth']['signOut'];
}

function persistSessionCookies(
  cookies: CookieWriter | undefined,
  data: { accessToken?: string | null; refreshToken?: string | null } | null,
  settings: AuthCookieSettings
): void {
  if (!data?.accessToken) {
    return;
  }

  setAuthCookies(
    cookies,
    {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    },
    settings
  );
}

function sanitizeAuthData<T>(data: T | null): SafeAuthData<T> | null {
  if (!data) {
    return null;
  }

  const {
    accessToken: _accessToken,
    refreshToken: _refreshToken,
    csrfToken: _csrfToken,
    ...safeData
  } = data as Record<string, unknown>;

  return safeData as SafeAuthData<T>;
}

function toSafeAuthResult<TMethod extends (...args: any[]) => Promise<any>>(
  result: Awaited<ReturnType<TMethod>>
): Awaited<ReturnType<SafeAuthAction<TMethod>>> {
  return {
    data: sanitizeAuthData(result.data),
    error: result.error,
  };
}

export function createAuthActions(options: CreateAuthActionsOptions = {}): AuthActions {
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
      'createAuthActions() requires a writable cookie store. Pass cookies in Server Actions or responseCookies in Route Handlers.'
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
      return toSafeAuthResult<InsForgeClient['auth']['signInWithPassword']>(result);
    },

    signInWithOAuth: async (providerOrOptions: any, signInOptions?: any) => {
      return createClient().auth.signInWithOAuth(providerOrOptions, signInOptions);
    },

    signInWithIdToken: async (credentials) => {
      const result = await createClient().auth.signInWithIdToken(credentials);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['signInWithIdToken']>(result);
    },

    exchangeOAuthCode: async (code, codeVerifier) => {
      const result = await createClient().auth.exchangeOAuthCode(code, codeVerifier);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['exchangeOAuthCode']>(result);
    },

    // The email-verification and password-reset senders, the reset-code
    // exchange, and the reset itself neither open nor close a session, so
    // there is nothing to write to the cookie store. The exchange hands back a
    // single-use reset token rather than session credentials, and the caller
    // needs it to complete the reset, so it is returned as-is.
    resendVerificationEmail: async (request) => {
      return createClient().auth.resendVerificationEmail(request);
    },

    verifyEmail: async (request) => {
      const result = await createClient().auth.verifyEmail(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['verifyEmail']>(result);
    },

    signInWithOtp: async (request) => {
      return createClient().auth.signInWithOtp(request);
    },

    verifyOtp: async (request) => {
      const result = await createClient().auth.verifyOtp(request);
      persistSessionCookies(writeCookies, result.data, cookieSettings);
      return toSafeAuthResult<InsForgeClient['auth']['verifyOtp']>(result);
    },

    sendResetPasswordEmail: async (request) => {
      return createClient().auth.sendResetPasswordEmail(request);
    },

    exchangeResetPasswordToken: async (request) => {
      return createClient().auth.exchangeResetPasswordToken(request);
    },

    resetPassword: async (request) => {
      return createClient().auth.resetPassword(request);
    },

    signOut: async () => {
      const result = await createClient().auth.signOut();
      clearAuthCookies(writeCookies, cookieSettings);
      return result;
    },
  };
}
