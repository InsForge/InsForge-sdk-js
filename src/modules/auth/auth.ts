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
  type AuthChangeEvent,
  type AuthStateChangeCallback,
} from '../../lib/token-manager';
import { AuthSession, InsForgeError } from '../../types';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  storePkceVerifier,
  retrievePkceVerifier,
  wrapError,
  cleanUrlParams,
} from './helpers';

import {
  ERROR_CODES,
  oAuthProvidersSchema,
  type CreateUserRequest,
  type CreateUserResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type GetOauthUrlResponse,
  type GetPublicAuthConfigResponse,
  type OAuthInitRequest,
  type OAuthProvidersSchema,
  type SendVerificationEmailRequest,
  type SendResetPasswordEmailRequest,
  type ExchangeResetPasswordTokenRequest,
  type ExchangeResetPasswordTokenResponse,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  type RefreshSessionResponse,
  type ResetPasswordResponse,
  type UserSchema,
  type GetProfileResponse,
  type OAuthCodeExchangeRequest,
} from '@insforge/shared-schemas';

interface AuthOptions {
  isServerMode?: boolean;
  detectOAuthCallback?: boolean;
}

type OAuthSignInOptions = {
  redirectTo: string;
  additionalParams?: Record<string, string>;
  skipBrowserRedirect?: boolean;
};

type OAuthSignInLegacyOptions = OAuthSignInOptions & {
  provider: OAuthProvidersSchema | string;
};

export class Auth {
  private authCallbackHandled: Promise<void>;

  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager,
    private options: AuthOptions = {}
  ) {
    this.authCallbackHandled =
      options.detectOAuthCallback === false ? Promise.resolve() : this.detectAuthCallback();
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
      CreateUserResponse | CreateSessionResponse | VerifyEmailResponse | RefreshSessionResponse,
    event: AuthChangeEvent = 'signedIn'
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
      this.tokenManager.saveSession(session, event);
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
   * Supports PKCE flow (insforge_code)
   */
  private async detectAuthCallback(): Promise<void> {
    if (this.isServerMode() || typeof window === 'undefined') {
      return;
    }

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
        this.isServerMode() ? '/api/auth/users?client_type=mobile' : '/api/auth/users',
        request,
        { credentials: 'include', skipAuthRefresh: true }
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
        this.isServerMode() ? '/api/auth/sessions?client_type=mobile' : '/api/auth/sessions',
        request,
        { credentials: 'include', skipAuthRefresh: true }
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
        const serverMode = this.isServerMode();
        const csrfToken = !serverMode ? getCsrfToken() : null;
        await this.http.post(
          serverMode ? '/api/auth/logout?client_type=mobile' : '/api/auth/logout',
          undefined,
          {
            credentials: 'include',
            skipAuthRefresh: true,
            ...(csrfToken ? { headers: { 'X-CSRF-Token': csrfToken } } : {}),
          }
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

  /**
   * Subscribe to auth state changes. The callback fires with `signedIn`,
   * `signedOut`, or `tokenRefreshed` whenever the stored session changes.
   *
   * @returns An unsubscribe function.
   *
   * @example
   * ```typescript
   * const unsubscribe = insforge.auth.onAuthStateChange((event) => {
   *   if (event === 'signedOut') redirectToLogin();
   * });
   * // later: unsubscribe();
   * ```
   */
  onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    return this.tokenManager.onAuthStateChange(callback);
  }

  // ============================================================================
  // OAuth Authentication
  // ============================================================================

  /**
   * Sign in with OAuth provider using PKCE flow
   */
  async signInWithOAuth(
    provider: OAuthProvidersSchema | string,
    options: OAuthSignInOptions
  ): Promise<{
    data: { url?: string; provider?: string; codeVerifier?: string };
    error: InsForgeError | null;
  }>;
  /**
   * @deprecated Use signInWithOAuth(provider, { redirectTo, additionalParams, skipBrowserRedirect }).
   */
  async signInWithOAuth(options: OAuthSignInLegacyOptions): Promise<{
    data: { url?: string; provider?: string; codeVerifier?: string };
    error: InsForgeError | null;
  }>;
  async signInWithOAuth(
    providerOrOptions: OAuthProvidersSchema | string | OAuthSignInLegacyOptions,
    options?: OAuthSignInOptions
  ): Promise<{
    data: { url?: string; provider?: string; codeVerifier?: string };
    error: InsForgeError | null;
  }> {
    try {
      let signInOptions: OAuthSignInLegacyOptions;

      if (typeof providerOrOptions === 'object') {
        signInOptions = providerOrOptions;
      } else if (options) {
        signInOptions = { provider: providerOrOptions, ...options };
      } else {
        return {
          data: {},
          error: new InsForgeError(
            'OAuth sign-in options are required',
            400,
            ERROR_CODES.INVALID_INPUT
          ),
        };
      }

      if (!signInOptions || !signInOptions.redirectTo) {
        return {
          data: {},
          error: new InsForgeError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT),
        };
      }

      const { provider } = signInOptions;
      const providerKey = encodeURIComponent(provider.toLowerCase());

      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      storePkceVerifier(codeVerifier);

      const params: OAuthInitRequest = {
        ...(signInOptions.additionalParams ?? {}),
        redirect_uri: signInOptions.redirectTo,
        code_challenge: codeChallenge,
      };

      const isBuiltInProvider = oAuthProvidersSchema.options.includes(
        providerKey as OAuthProvidersSchema
      );
      const oauthPath = isBuiltInProvider
        ? `/api/auth/oauth/${providerKey}`
        : `/api/auth/oauth/custom/${providerKey}`;

      const response = await this.http.get<GetOauthUrlResponse>(oauthPath, {
        params,
        skipAuthRefresh: true,
      });

      if (
        !this.isServerMode() &&
        typeof window !== 'undefined' &&
        !signInOptions.skipBrowserRedirect
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
          'UNEXPECTED_ERROR'
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
    codeVerifier?: string
  ): Promise<{
    data: CreateSessionResponse | null;
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
            'PKCE_VERIFIER_MISSING'
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
        { credentials: 'include', skipAuthRefresh: true }
      );

      this.saveSessionFromResponse(response);

      return {
        data: response,
        error: null,
      };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred during OAuth code exchange');
    }
  }

  /**
   * Sign in with an ID token from a native SDK (Google One Tap, etc.)
   * Use this for native mobile apps or Google One Tap on web.
   *
   * @param credentials.provider - The identity provider (currently only 'google' is supported)
   * @param credentials.token - The ID token from the native SDK
   */
  async signInWithIdToken(credentials: { provider: 'google'; token: string }): Promise<{
    data: CreateSessionResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const { provider, token } = credentials;

      const response = await this.http.post<CreateSessionResponse>(
        '/api/auth/id-token?client_type=mobile',
        { provider, token },
        { credentials: 'include', skipAuthRefresh: true }
      );

      this.saveSessionFromResponse(response);
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }

      return {
        data: response,
        error: null,
      };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred during ID token sign in');
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
   * Legacy server mode (`isServerMode: true`):
   * - Uses mobile auth flow and requires `refreshToken` in request body.
   *
   * SSR apps should prefer `createRefreshAuthRouter()` / `refreshAuth()` from
   * `@insforge/sdk/ssr`.
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
            ERROR_CODES.AUTH_UNAUTHORIZED
          ),
        };
      }

      const csrfToken = !this.isServerMode() ? getCsrfToken() : null;

      const response = await this.http.post<RefreshSessionResponse>(
        this.isServerMode() ? '/api/auth/refresh?client_type=mobile' : '/api/auth/refresh',
        this.isServerMode() ? { refresh_token: options?.refreshToken } : undefined,
        {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
          credentials: 'include',
          skipAuthRefresh: true,
        }
      );

      if (response.accessToken) {
        this.saveSessionFromResponse(response, 'tokenRefreshed');
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred during session refresh');
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
        if (!accessToken) {
          return { data: { user: null }, error: null };
        }

        this.http.setAuthToken(accessToken);
        const response = await this.http.get<{ user: UserSchema }>('/api/auth/sessions/current');
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
        const { data: refreshed, error: refreshError } = await this.refreshSession();
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
          'UNEXPECTED_ERROR'
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
      const response = await this.http.get<GetProfileResponse>(`/api/auth/profiles/${userId}`);
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while fetching user profile');
    }
  }

  async setProfile(profile: Record<string, unknown>): Promise<{
    data: GetProfileResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.patch<GetProfileResponse>('/api/auth/profiles/current', {
        profile,
      });

      const currentUser = this.tokenManager.getUser();
      if (!this.isServerMode() && currentUser && response.profile !== undefined) {
        this.tokenManager.setUser({
          ...currentUser,
          profile: response.profile,
        });
      }

      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while updating user profile');
    }
  }

  // ============================================================================
  // Email Verification
  // ============================================================================

  async resendVerificationEmail(request: SendVerificationEmailRequest): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        success: boolean;
        message: string;
      }>('/api/auth/email/send-verification', request, {
        skipAuthRefresh: true,
      });
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while sending verification email');
    }
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
        { credentials: 'include', skipAuthRefresh: true }
      );

      this.saveSessionFromResponse(response);
      if (response.refreshToken) {
        this.http.setRefreshToken(response.refreshToken);
      }
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while verifying email');
    }
  }

  // ============================================================================
  // Password Reset
  // ============================================================================

  async sendResetPasswordEmail(request: SendResetPasswordEmailRequest): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{
        success: boolean;
        message: string;
      }>('/api/auth/email/send-reset-password', request, {
        skipAuthRefresh: true,
      });
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while sending password reset email');
    }
  }

  async exchangeResetPasswordToken(request: ExchangeResetPasswordTokenRequest): Promise<{
    data: ExchangeResetPasswordTokenResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<ExchangeResetPasswordTokenResponse>(
        '/api/auth/email/exchange-reset-password-token',
        request,
        { skipAuthRefresh: true }
      );
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while verifying reset code');
    }
  }

  async resetPassword(request: { newPassword: string; otp: string }): Promise<{
    data: ResetPasswordResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<ResetPasswordResponse>(
        '/api/auth/email/reset-password',
        request,
        { skipAuthRefresh: true }
      );
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while resetting password');
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
      const response = await this.http.get<GetPublicAuthConfigResponse>('/api/auth/public-config', {
        skipAuthRefresh: true,
      });
      return { data: response, error: null };
    } catch (error) {
      return wrapError(error, 'An unexpected error occurred while fetching auth configuration');
    }
  }
}
