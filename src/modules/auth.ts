/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

import { HttpClient } from '../lib/http-client';
import { TokenManager } from '../lib/token-manager';
import { SecureSessionStorage, LocalSessionStorage, AUTH_FLAG_COOKIE, TOKEN_KEY, USER_KEY } from '../lib/session-storage';
import { AuthSession, InsForgeError } from '../types';

import type {
  CreateUserRequest,
  CreateUserResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetCurrentSessionResponse,
  GetOauthUrlResponse,
  GetPublicAuthConfigResponse,
  OAuthProvidersSchema,
  SendVerificationEmailRequest,
  SendResetPasswordEmailRequest,
  ExchangeResetPasswordTokenRequest,
  VerifyEmailRequest,
  UserSchema,
  GetProfileResponse,
} from '@insforge/shared-schemas';

/**
 * Check if current environment is a hosted auth environment
 * Returns true for:
 * - localhost with port 7130 (hosted auth app dev)
 * - https://*.insforge.app (hosted auth app production)
 */
function isHostedAuthEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, port, protocol } = window.location;

  // Check for localhost:7130
  if (hostname === 'localhost' && port === '7130') {
    return true;
  }

  // Check for https://*.insforge.app
  if (protocol === 'https:' && hostname.endsWith('.insforge.app')) {
    return true;
  }

  return false;
}

export class Auth {
  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager
  ) {
    // Auto-detect OAuth callback parameters in the URL
    this.detectAuthCallback();
  }

  /**
   * Automatically detect and handle OAuth callback parameters in the URL
   * This runs after initialization to seamlessly complete the OAuth flow
   * Matches the backend's OAuth callback response (backend/src/api/routes/auth.ts:540-544)
   */
  private async detectAuthCallbackAsync(): Promise<void> {
    // Only run in browser environment
    if (typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);

      // Backend returns: access_token, user_id, email, name (optional)
      const accessToken = params.get('access_token');
      const userId = params.get('user_id');
      const email = params.get('email');
      const name = params.get('name');

      // Check if we have OAuth callback parameters
      if (accessToken && userId && email) {
        // Detect backend storage mode first (before saving session)
        // Backend sets isAuthenticated cookie during OAuth redirect
        this._detectStorageAfterAuth();

        // Create session with the data from backend
        const session: AuthSession = {
          accessToken,
          user: {
            id: userId,
            email: email,
            name: name || '',
            // These fields are not provided by backend OAuth callback
            // They'll be populated when calling getCurrentUser()
            emailVerified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any,
        };

        // Save session and set auth token
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(accessToken);

        // Clean up the URL to remove sensitive parameters
        const url = new URL(window.location.href);
        url.searchParams.delete('access_token');
        url.searchParams.delete('user_id');
        url.searchParams.delete('email');
        url.searchParams.delete('name');

        // Also handle error case from backend (line 581)
        if (params.has('error')) {
          url.searchParams.delete('error');
        }

        // Replace URL without adding to browser history
        window.history.replaceState({}, document.title, url.toString());
      }
    } catch (error) {
      // Silently continue - don't break initialization
      console.debug('OAuth callback detection skipped:', error);
    }
  }

  /**
   * Sign up a new user
   */
  async signUp(request: CreateUserRequest): Promise<{
    data: CreateUserResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<CreateUserResponse>('/api/auth/users', request);

      // Save session internally only if both accessToken and user exist
      if (response.accessToken && response.user) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        if (!isHostedAuthEnvironment()) {
          this.tokenManager.saveSession(session);
        }
        this.http.setAuthToken(response.accessToken);
        // Detect backend storage mode in background (fire and forget)
        this._detectStorageAfterAuth();
      }

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          error instanceof Error ? error.message : 'An unexpected error occurred during sign up',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Sign in with email and password
   */
  async signInWithPassword(request: CreateSessionRequest): Promise<{
    data: CreateSessionResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<CreateSessionResponse>('/api/auth/sessions', request);

      // Save session internally
      const session: AuthSession = {
        accessToken: response.accessToken || '',
        user: response.user || {
          id: '',
          email: '',
          name: '',
          emailVerified: false,
          createdAt: '',
          updatedAt: '',
        },
      };

      if (!isHostedAuthEnvironment()) {
        this.tokenManager.saveSession(session);
      }
      this.http.setAuthToken(response.accessToken || '');

      // Detect backend storage mode in background (fire and forget)
      // This will switch to SecureSessionStorage if backend supports cookie mode
      this._detectStorageAfterAuth();

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred during sign in',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Sign in with OAuth provider
   */
  async signInWithOAuth(options: {
    provider: OAuthProvidersSchema;
    redirectTo?: string;
    skipBrowserRedirect?: boolean;
  }): Promise<{
    data: { url?: string; provider?: string };
    error: InsForgeError | null;
  }> {
    try {
      const { provider, redirectTo, skipBrowserRedirect } = options;

      const params = redirectTo
        ? { redirect_uri: redirectTo }
        : undefined;

      const endpoint = `/api/auth/oauth/${provider}`;
      const response = await this.http.get<GetOauthUrlResponse>(endpoint, { params });

      // Automatically redirect in browser unless told not to
      if (typeof window !== 'undefined' && !skipBrowserRedirect) {
        window.location.href = response.authUrl;
        return { data: {}, error: null };
      }

      return {
        data: {
          url: response.authUrl,
          provider
        },
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: {}, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: {},
        error: new InsForgeError(
          'An unexpected error occurred during OAuth initialization',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Sign out the current user
   * In modern mode, also calls backend to clear the refresh token cookie
   */
  async signOut(): Promise<{ error: InsForgeError | null }> {
    try {
      // If using secure storage, call backend to clear refresh token cookie
      if (this.tokenManager.getStrategyId() === 'secure') {
        try {
          await this.http.post('/api/auth/logout');
        } catch {
          // Ignore errors from logout endpoint - still clear local session
        }
      }

      this.tokenManager.clearSession();
      this.http.setAuthToken(null);

      return { error: null };
    } catch (error) {
      return {
        error: new InsForgeError(
          'Failed to sign out',
          500,
          'SIGNOUT_ERROR'
        )
      };
    }
  }

  /**
   * Refresh the access token using the httpOnly refresh token cookie
   * Only works when backend supports secure session storage (httpOnly cookies)
   * 
   * @returns New access token or throws an error
   */
  async refreshToken(): Promise<string> {
    try {
      const response = await this.http.post<{ accessToken: string; user?: any }>(
        '/api/auth/refresh'
      );

      if (response.accessToken) {
        // Update token manager with new token
        this.tokenManager.setAccessToken(response.accessToken);
        this.http.setAuthToken(response.accessToken);

        // Update user data if provided
        if (response.user) {
          this.tokenManager.setUser(response.user);
        }

        return response.accessToken;
      }

      throw new InsForgeError(
        'No access token in refresh response',
        500,
        'REFRESH_FAILED'
      );
    } catch (error) {
      if (error instanceof InsForgeError) {
        // Only clear session on auth-related errors
        if (error.statusCode === 401 || error.statusCode === 403) {
          this.tokenManager.clearSession();
          this.http.setAuthToken(null);
        }
        throw error;
      }

      throw new InsForgeError(
        'Token refresh failed',
        500,
        'REFRESH_FAILED'
      );
    }
  }


  /**
   * Get all public authentication configuration (OAuth + Email)
   * Returns both OAuth providers and email authentication settings in one request
   * This is a public endpoint that doesn't require authentication
   * 
   * @returns Complete public authentication configuration including OAuth providers and email auth settings
   * 
   * @example
   * ```ts
   * const { data, error } = await insforge.auth.getPublicAuthConfig();
   * if (data) {
   *   console.log(`OAuth providers: ${data.oauth.data.length}`);
   *   console.log(`Password min length: ${data.email.passwordMinLength}`);
   * }
   * ```
   */
  async getPublicAuthConfig(): Promise<{
    data: GetPublicAuthConfigResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.get<GetPublicAuthConfigResponse>('/api/auth/public-config');

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while fetching public authentication configuration',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }


  /**
   * Get the current user with full profile information
   * Returns both auth info (id, email, role) and profile data (dynamic fields from users table)
   * 
   * In secure session mode (httpOnly cookie), this method will automatically attempt
   * to refresh the session if no access token is available (e.g., after page reload).
   */
  async getCurrentUser(): Promise<{
    data: {
      user: UserSchema;
    } | null;
    error: any | null;
  }> {
    try {
      // Check if we have a token
      // Use getAccessToken() instead of getSession() to avoid requiring user data
      // This decouples token availability from cached user data
      let accessToken = this.tokenManager.getAccessToken();

      // In secure mode, if no token in memory but auth cookie exists, try to refresh
      // This handles page reload scenario where access token was in memory only
      if (!accessToken && this.tokenManager.shouldAttemptRefresh()) {
        try {
          accessToken = await this.refreshToken();
        } catch {
          // Refresh failed, user is not authenticated
          return { data: null, error: null };
        }
      }

      if (!accessToken) {
        return { data: null, error: null };
      }

      // Call the API for auth info
      this.http.setAuthToken(accessToken);
      const authResponse = await this.http.get<GetCurrentSessionResponse>('/api/auth/sessions/current');

      return {
        data: {
          user: authResponse.user,
        },
        error: null
      };
    } catch (error) {
      // If unauthorized, clear session
      if (error instanceof InsForgeError && error.statusCode === 401) {
        await this.signOut();
        return { data: null, error: null };
      }

      // Pass through all other errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while fetching user',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Get any user's profile by ID
   * Returns profile information from the users table
   */
  async getProfile(userId: string): Promise<{
    data: GetProfileResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.get<GetProfileResponse>(`/api/auth/profiles/${userId}`);

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged (includes 404 NOT_FOUND, 400 INVALID_INPUT)
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while fetching user profile',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Get the current session (only session data, no API call)
   * Returns the stored JWT token and basic user info from local storage
   */
  getCurrentSession(): {
    data: { session: AuthSession | null };
    error: InsForgeError | null;
  } {
    try {
      const session = this.tokenManager.getSession();

      if (session?.accessToken) {
        this.http.setAuthToken(session.accessToken);
        return { data: { session }, error: null };
      }

      return { data: { session: null }, error: null };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: { session: null }, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: { session: null },
        error: new InsForgeError(
          'An unexpected error occurred while getting session',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Set/Update the current user's profile
   * Updates profile information in the users table (supports any dynamic fields)
   * Requires authentication
   */
  async setProfile(profile: Record<string, unknown>): Promise<{
    data: GetProfileResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.patch<GetProfileResponse>(
        '/api/auth/profiles/current',
        { profile }
      );

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged (includes 401 AUTH_INVALID_CREDENTIALS, 400 INVALID_INPUT)
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while updating user profile',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Send email verification (code or link based on config)
   *
   * Send email verification using the method configured in auth settings (verifyEmailMethod).
   * When method is 'code', sends a 6-digit numeric code. When method is 'link', sends a magic link.
   * Prevents user enumeration by returning success even if email doesn't exist.
   */
  async sendVerificationEmail(request: SendVerificationEmailRequest): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ success: boolean; message: string }>(
        '/api/auth/email/send-verification',
        request
      );

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while sending verification code',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Send password reset (code or link based on config)
   *
   * Send password reset email using the method configured in auth settings (resetPasswordMethod).
   * When method is 'code', sends a 6-digit numeric code for two-step flow.
   * When method is 'link', sends a magic link.
   * Prevents user enumeration by returning success even if email doesn't exist.
   */
  async sendResetPasswordEmail(request: SendResetPasswordEmailRequest): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ success: boolean; message: string }>(
        '/api/auth/email/send-reset-password',
        request
      );

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while sending password reset code',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Exchange reset password code for reset token
   *
   * Step 1 of two-step password reset flow (only used when resetPasswordMethod is 'code'):
   * 1. Verify the 6-digit code sent to user's email
   * 2. Return a reset token that can be used to actually reset the password
   *
   * This endpoint is not used when resetPasswordMethod is 'link' (magic link flow is direct).
   */
  async exchangeResetPasswordToken(request: ExchangeResetPasswordTokenRequest): Promise<{
    data: { token: string; expiresAt: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ token: string; expiresAt: string }>(
        '/api/auth/email/exchange-reset-password-token',
        request
      );

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while verifying reset code',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Reset password with token
   *
   * Reset user password with a token. The token can be:
   * - Magic link token (64-character hex token from send-reset-password when method is 'link')
   * - Reset token (from exchange-reset-password-token after code verification when method is 'code')
   *
   * Both token types use RESET_PASSWORD purpose and are verified the same way.
   *
   * Flow summary:
   * - Code method: send-reset-password → exchange-reset-password-token → reset-password (with resetToken)
   * - Link method: send-reset-password → reset-password (with link token directly)
   */
  async resetPassword(request: { newPassword: string; otp: string }): Promise<{
    data: { message: string; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ message: string; redirectTo?: string }>(
        '/api/auth/email/reset-password',
        request
      );

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while resetting password',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Verify email with code or link
   *
   * Verify email address using the method configured in auth settings (verifyEmailMethod):
   * - Code verification: Provide both `email` and `otp` (6-digit numeric code)
   * - Link verification: Provide only `otp` (64-character hex token from magic link)
   *
   * Successfully verified users will receive a session token.
   *
   * The email verification link sent to users always points to the backend API endpoint.
   * If `verifyEmailRedirectTo` is configured, the backend will redirect to that URL after successful verification.
   * Otherwise, a default success page is displayed.
   */
  async verifyEmail(request: VerifyEmailRequest): Promise<{
    data: { accessToken: string; user?: any; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ accessToken: string; user?: any; redirectTo?: string }>(
        '/api/auth/email/verify',
        request
      );

      // Save session if we got a token
      if (response.accessToken) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user || {} as any,
        };
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(response.accessToken);
      }

      return {
        data: response,
        error: null
      };
    } catch (error) {
      // Pass through API errors unchanged
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }

      // Generic fallback for unexpected errors
      return {
        data: null,
        error: new InsForgeError(
          'An unexpected error occurred while verifying email',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }
}