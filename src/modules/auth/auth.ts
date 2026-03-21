/**
 * Auth module for InsForge SDK
 * Handles authentication, sessions, profiles, and email verification
 */

import { HttpClient } from '../../lib/http-client';
import {
  TokenManager,
  getCsrfToken,
  setCsrfToken,
  clearCsrfToken,
} from '../../lib/token-manager';
import { AuthRefreshResponse, AuthSession, InsForgeError } from '../../types';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  storePkceVerifier,
  retrievePkceVerifier,
  wrapError,
  cleanUrlParams,
} from './helpers';

import type {
  CreateUserRequest,
  CreateUserResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetOauthUrlResponse,
  GetPublicAuthConfigResponse,
  OAuthProvidersSchema,
  SendVerificationEmailRequest,
  SendResetPasswordEmailRequest,
  ExchangeResetPasswordTokenRequest,
  VerifyEmailRequest,
  VerifyEmailResponse,
  RefreshSessionResponse,
  UserSchema,
  GetProfileResponse,
  OAuthCodeExchangeRequest,
} from '@insforge/shared-schemas';
import { oAuthProvidersSchema } from '@insforge/shared-schemas';

interface AuthOptions {
  isServerMode?: boolean;
}

export class Auth {
  private authCallbackHandled: Promise<void>;

  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager,
    private options: AuthOptions = {},
  ) {
    this.authCallbackHandled = this.detectAuthCallback();
  }

  private isServerMode(): boolean {
    return !!this.options.isServerMode;
  }

  /**
   * Save session from API response
   * Handles token storage, CSRF token, and HTTP auth header
   */
  private saveSessionFromResponse(
    response:
      | CreateUserResponse
      | CreateSessionResponse
      | VerifyEmailResponse
      | RefreshSessionResponse,
  ): boolean {
    if (!response.accessToken || !response.user) {
      return false;
    }

    const session: AuthSession = {
      accessToken: response.accessToken,
      user: response.user,
    };

    // Browser web flow: csrf token is returned for cookie-based refresh
    if (!this.isServerMode() && response.csrfToken) {
      setCsrfToken(response.csrfToken);
    }

    if (!this.isServerMode()) {
      this.tokenManager.saveSession(session);
    }
    this.http.setAuthToken(response.accessToken);
    this.http.setRefreshToken(response.refreshToken ?? null);
    return true;
  }

  // ============================================================================
  // OAuth Callback Detection (runs on initialization)
  // ============================================================================

  /**
   * Detect and handle OAuth callback parameters in URL
   * Supports PKCE flow (insforge_code) and legacy flow (access_token in URL)
   */
  private async detectAuthCallback(): Promise<void> {
    if (this.isServerMode() || typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);

      // Handle error callback
      const error = params.get('error');
      if (error) {
        cleanUrlParams('error');
        console.debug('OAuth callback error:', error);
        return;
      }

      // PKCE flow: exchange code for tokens
      const code = params.get('insforge_code');
      if (code) {
        cleanUrlParams('insforge_code');
        const { error: exchangeError } = await this.exchangeOAuthCode(code);
        if (exchangeError) {
          console.debug('OAuth code exchange failed:', exchangeError.message);
        }
        return;
      }

      // Legacy flow: tokens directly in URL (backward compatible)
      const accessToken = params.get('access_token');
      const userId = params.get('user_id');
      const email = params.get('email');

      if (accessToken && userId && email) {
        const csrfToken = params.get('csrf_token');
        const name = params.get('name');

        if (csrfToken) {
          setCsrfToken(csrfToken);
        }

        const session: AuthSession = {
          accessToken,
          user: {
            id: userId,
            email,
            profile: { name: name || '' },
            metadata: null,
            emailVerified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };

        this.tokenManager.saveSession(session);
        this.http.setAuthToken(accessToken);
        cleanUrlParams(
          'access_token',
          'user_id',
          'email',
          'name',
          'csrf_token',
        );
      }
    } catch (error) {
      console.debug('OAuth callback detection skipped:', error);
    }
  }

  // ============================================================================
  // Sign Up / Sign In / Sign Out
  // ============================================================================

  async signUp(request: CreateUserRequest): Promise<{
    data: CreateUserResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<CreateUserResponse>(
        this.isServerMode()
          ? '/api/auth/users?client_type=mobile'
          : '/api/auth/users',
        request,
        { credentials: 'include' },
      );

      if (response.accessToken && response.user) {
        this.saveSessionFromResponse(response);
      }
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred during sign up');
    }
  }

  async signInWithPassword(request: CreateSessionRequest): Promise<{
    data: CreateSessionResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<CreateSessionResponse>(
        this.isServerMode()
          ? '/api/auth/sessions?client_type=mobile'
          : '/api/auth/sessions',
        request,
        { credentials: 'include' },
      );

      this.saveSessionFromResponse(response);
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred during sign in');
    }
  }

  async signOut(): Promise<{ error: InsForgeError | null }> {
    try {
      // Try backend logout first
      try {
        await this.http.post(
          this.isServerMode()
            ? '/api/auth/logout?client_type=mobile'
            : '/api/auth/logout',
          undefined,
          { credentials: 'include' },
        );
      } catch {
        // Ignore backend logout failure so local state is still cleared
      }

      this.tokenManager.clearSession();
      this.http.setAuthToken(null);
      this.http.setRefreshToken(null);
      if (!this.isServerMode()) {
        clearCsrfToken();
      }

      return { error: null };
    } catch {
      return {
        error: new InsForgeError('Failed to sign out', 500, 'SIGNOUT_ERROR'),
      };
    }
  }

  // ============================================================================
  // OAuth Authentication
  // ============================================================================

  /**
   * Sign in with OAuth provider using PKCE flow
   */
  async signInWithOAuth(options: {
    provider: OAuthProvidersSchema | string;
    redirectTo?: string;
    skipBrowserRedirect?: boolean;
  }): Promise<{
    data: { url?: string; provider?: string; codeVerifier?: string };
    error: InsForgeError | null;
  }> {
    try {
      const { provider, redirectTo, skipBrowserRedirect } = options;
      const providerKey = encodeURIComponent(provider.toLowerCase());

      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      storePkceVerifier(codeVerifier);

      const params: Record<string, string> = { code_challenge: codeChallenge };
      if (redirectTo) params.redirect_uri = redirectTo;
      const isBuiltInProvider = oAuthProvidersSchema.options.includes(
        providerKey as OAuthProvidersSchema,
      );
      const oauthPath = isBuiltInProvider
        ? `/api/auth/oauth/${providerKey}`
        : `/api/auth/oauth/custom/${providerKey}`;

      const response = await this.http.get<GetOauthUrlResponse>(oauthPath, {
        params,
      });

      if (
        !this.isServerMode() &&
        typeof window !== 'undefined' &&
        !skipBrowserRedirect
      ) {
        window.location.href = response.authUrl;
        return { data: {}, error: null };
      }

      return {
        data: { url: response.authUrl, provider: providerKey, codeVerifier },
        error: null,
      };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: {}, error };
      }
      return {
        data: {},
        error: new InsForgeError(
          'An unexpected error occurred during OAuth initialization',
          500,
          'UNEXPECTED_ERROR',
        ),
      };
    }
  }

  /**
   * Exchange OAuth authorization code for tokens (PKCE flow)
   * Called automatically on initialization when insforge_code is in URL
   */
  async exchangeOAuthCode(
    code: string,
    codeVerifier?: string,
  ): Promise<{
    data: {
      accessToken: string;
      refreshToken?: string;
      user: UserSchema;
      redirectTo?: string;
    } | null;
    error: InsForgeError | null;
  }> {
    try {
      const verifier = codeVerifier ?? retrievePkceVerifier();

      if (!verifier) {
        return {
          data: null,
          error: new InsForgeError(
            'PKCE code verifier not found. Ensure signInWithOAuth was called in the same browser session.',
            400,
            'PKCE_VERIFIER_MISSING',
          ),
        };
      }

      const request: OAuthCodeExchangeRequest = {
        code,
        code_verifier: verifier,
      };
      const response = await this.http.post<CreateSessionResponse>(
        this.isServerMode()
          ? '/api/auth/oauth/exchange?client_type=mobile'
          : '/api/auth/oauth/exchange',
        request,
        { credentials: 'include' },
      );

      this.saveSessionFromResponse(response);

      return {
        data: {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: response.user,
          redirectTo: response.redirectTo,
        },
        error: null,
      };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred during OAuth code exchange',
      );
    }
  }

  /**
   * Sign in with an ID token from a native SDK (Google One Tap, etc.)
   * Use this for native mobile apps or Google One Tap on web.
   *
   * @param credentials.provider - The identity provider (currently only 'google' is supported)
   * @param credentials.token - The ID token from the native SDK
   */
  async signInWithIdToken(credentials: {
    provider: 'google';
    token: string;
  }): Promise<{
    data: {
      accessToken: string;
      refreshToken?: string;
      user: UserSchema;
    } | null;
    error: InsForgeError | null;
  }> {
    try {
      const { provider, token } = credentials;

      const response = await this.http.post<CreateSessionResponse>(
        '/api/auth/id-token?client_type=mobile',
        { provider, token },
        { credentials: 'include' },
      );

      this.saveSessionFromResponse(response);
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }

      return {
        data: {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: response.user,
        },
        error: null,
      };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred during ID token sign in',
      );
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Refresh the current auth session.
   *
   * Browser mode:
   * - Uses httpOnly refresh cookie and optional CSRF header.
   *
   * Server mode (`isServerMode: true`):
   * - Uses mobile auth flow and requires `refreshToken` in request body.
   */
  async refreshSession(options?: { refreshToken?: string }): Promise<{
    data: RefreshSessionResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      if (this.isServerMode() && !options?.refreshToken) {
        return {
          data: null,
          error: new InsForgeError(
            'refreshToken is required when refreshing session in server mode',
            400,
            'REFRESH_TOKEN_REQUIRED',
          ),
        };
      }

      const csrfToken = !this.isServerMode() ? getCsrfToken() : null;

      const response = await this.http.post<RefreshSessionResponse>(
        this.isServerMode()
          ? '/api/auth/refresh?client_type=mobile'
          : '/api/auth/refresh',
        this.isServerMode()
          ? { refresh_token: options?.refreshToken }
          : undefined,
        {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
          credentials: 'include',
        },
      );

      if (response.accessToken) {
        this.saveSessionFromResponse(response);
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred during session refresh',
      );
    }
  }

  /**
   * Get current user, automatically waits for pending OAuth callback
   */
  async getCurrentUser(): Promise<{
    data: { user: UserSchema | null };
    error: InsForgeError | null;
  }> {
    await this.authCallbackHandled;

    try {
      if (this.isServerMode()) {
        const accessToken = this.tokenManager.getAccessToken();
        if (!accessToken) return { data: { user: null }, error: null };

        this.http.setAuthToken(accessToken);
        const response = await this.http.get<{ user: UserSchema }>(
          '/api/auth/sessions/current',
        );
        const user = response.user ?? null;
        return { data: { user }, error: null };
      }

      // Browser mode: check memory first
      const session = this.tokenManager.getSession();
      if (session) {
        this.http.setAuthToken(session.accessToken);
        return { data: { user: session.user }, error: null };
      }

      // Try refresh via httpOnly cookie (browser only)
      if (typeof window !== 'undefined') {
        const { data: refreshed, error: refreshError } =
          await this.refreshSession();
        if (refreshError) {
          return { data: { user: null }, error: refreshError };
        }
        if (refreshed?.accessToken) {
          return { data: { user: refreshed.user ?? null }, error: null };
        }
      }

      return { data: { user: null }, error: null };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: { user: null }, error };
      }
      return {
        data: { user: null },
        error: new InsForgeError(
          'An unexpected error occurred while getting user',
          500,
          'UNEXPECTED_ERROR',
        ),
      };
    }
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  async getProfile(userId: string): Promise<{
    data: GetProfileResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.get<GetProfileResponse>(
        `/api/auth/profiles/${userId}`,
      );
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while fetching user profile',
      );
    }
  }

  async setProfile(profile: Record<string, unknown>): Promise<{
    data: GetProfileResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.patch<GetProfileResponse>(
        '/api/auth/profiles/current',
        {
          profile,
        },
      );

      const currentUser = this.tokenManager.getUser();
      if (
        !this.isServerMode() &&
        currentUser &&
        response.profile !== undefined
      ) {
        this.tokenManager.setUser({
          ...currentUser,
          profile: response.profile,
        });
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while updating user profile',
      );
    }
  }

  // ============================================================================
  // Email Verification
  // ============================================================================

  async resendVerificationEmail(
    request: SendVerificationEmailRequest,
  ): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        success: boolean;
        message: string;
      }>('/api/auth/email/send-verification', request);
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while sending verification code',
      );
    }
  }

  /** @deprecated Use `resendVerificationEmail` instead */
  async sendVerificationEmail(request: SendVerificationEmailRequest) {
    return this.resendVerificationEmail(request);
  }

  async verifyEmail(request: VerifyEmailRequest): Promise<{
    data: VerifyEmailResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<VerifyEmailResponse>(
        this.isServerMode()
          ? '/api/auth/email/verify?client_type=mobile'
          : '/api/auth/email/verify',
        request,
        { credentials: 'include' },
      );

      this.saveSessionFromResponse(response);
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while verifying email',
      );
    }
  }

  // ============================================================================
  // Password Reset
  // ============================================================================

  async sendResetPasswordEmail(
    request: SendResetPasswordEmailRequest,
  ): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        success: boolean;
        message: string;
      }>('/api/auth/email/send-reset-password', request);
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while sending password reset code',
      );
    }
  }

  async exchangeResetPasswordToken(
    request: ExchangeResetPasswordTokenRequest,
  ): Promise<{
    data: { token: string; expiresAt: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        token: string;
        expiresAt: string;
      }>('/api/auth/email/exchange-reset-password-token', request);
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while verifying reset code',
      );
    }
  }

  async resetPassword(request: { newPassword: string; otp: string }): Promise<{
    data: { message: string; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        message: string;
        redirectTo?: string;
      }>('/api/auth/email/reset-password', request);
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while resetting password',
      );
    }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async getPublicAuthConfig(): Promise<{
    data: GetPublicAuthConfigResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.get<GetPublicAuthConfigResponse>(
        '/api/auth/public-config',
      );
      return { data: response, error: null };
    } catch (error) {
      return wrapError(
        error,
        'An unexpected error occurred while fetching auth configuration',
      );
    }
  }
}
