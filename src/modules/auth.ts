/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

import { HttpClient } from '../lib/http-client';
import { TokenManager, getCsrfToken, setCsrfToken, clearCsrfToken } from '../lib/token-manager';
import { AuthSession, InsForgeError } from '../types';

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
  UserSchema,
  GetProfileResponse,
  OAuthCodeExchangeRequest
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

// ============================================================================
// PKCE (Proof Key for Code Exchange) Utilities
// ============================================================================

const PKCE_VERIFIER_KEY = 'insforge_pkce_verifier';

/**
 * Generate a cryptographically random code verifier for PKCE
 * RFC 7636 recommends 43-128 characters from unreserved URI characters
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate code challenge from verifier using SHA-256 (S256 method)
 * This is the recommended method per RFC 7636
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64 URL encode without padding (per RFC 7636)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Store PKCE code verifier in sessionStorage
 * Uses sessionStorage so it persists across the OAuth redirect but clears on tab close
 */
function storePkceVerifier(verifier: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  }
}

/**
 * Retrieve and clear PKCE code verifier from sessionStorage
 * Clears after retrieval to prevent reuse
 */
function retrievePkceVerifier(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (verifier) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  }
  return verifier;
}

export class Auth {
  /**
   * Promise that resolves when OAuth callback handling is complete.
   * Resolves immediately if no OAuth callback is detected in the URL.
   */
  private authCallbackHandled: Promise<void>;

  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager
  ) {
    // Auto-detect OAuth callback parameters in the URL
    this.authCallbackHandled = this.detectAuthCallback();
  }

  /**
   * Automatically detect and handle OAuth callback parameters in the URL
   * This runs after initialization to seamlessly complete the OAuth flow
   *
   * Supports two flows:
   * - PKCE flow (new): Backend returns `insforge_code` param, exchanged for tokens
   * - Legacy flow: Backend returns tokens directly in URL (backward compatible)
   */
  private async detectAuthCallback(): Promise<void> {
    // Only run in browser environment
    if (typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);

      // Check for error first
      const error = params.get('error');
      if (error) {
        // Clean up error from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('error');
        window.history.replaceState({}, document.title, url.toString());
        console.debug('OAuth callback error:', error);
        return;
      }

      // New PKCE flow: Backend returns authorization code as insforge_code
      const code = params.get('insforge_code');
      if (code) {
        // Clean up URL immediately (before async exchange)
        const url = new URL(window.location.href);
        url.searchParams.delete('insforge_code');
        window.history.replaceState({}, document.title, url.toString());

        // Exchange code for tokens
        const { error: exchangeError } = await this.exchangeOAuthCode(code);
        if (exchangeError) {
          console.debug('OAuth code exchange failed:', exchangeError.message);
        }
        return;
      }

      // Legacy flow: Backend returns tokens directly in URL (backward compatible)
      const accessToken = params.get('access_token');
      const userId = params.get('user_id');
      const email = params.get('email');
      const name = params.get('name');
      const csrfToken = params.get('csrf_token');

      if (accessToken && userId && email) {
        if (csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(csrfToken);
        }

        const session: AuthSession = {
          accessToken,
          user: {
            id: userId,
            email: email,
            profile: { name: name || '' },
            metadata: null,
            emailVerified: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };

        this.tokenManager.saveSession(session);
        this.http.setAuthToken(accessToken);

        // Clean up the URL
        const url = new URL(window.location.href);
        url.searchParams.delete('access_token');
        url.searchParams.delete('user_id');
        url.searchParams.delete('email');
        url.searchParams.delete('name');
        url.searchParams.delete('csrf_token');
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
      const response = await this.http.post<CreateUserResponse>('/api/auth/users', request, { credentials: 'include' });

      // Save session internally only if both accessToken and user exist
      if (response.accessToken && response.user && !isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        if (response.csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(response.csrfToken);
        }
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
      const response = await this.http.post<CreateSessionResponse>('/api/auth/sessions', request, { credentials: 'include' });

      if (!isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        if (response.csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(response.csrfToken);
        }
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
          'An unexpected error occurred during sign in',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Sign in with OAuth provider
   * Uses PKCE (Proof Key for Code Exchange) for enhanced security
   */
  async signInWithOAuth(options: {
    provider: OAuthProvidersSchema;
    redirectTo?: string;
    skipBrowserRedirect?: boolean;
  }): Promise<{
    data: { url?: string; provider?: string; codeVerifier?: string };
    error: InsForgeError | null;
  }> {
    try {
      const { provider, redirectTo, skipBrowserRedirect } = options;

      // Generate PKCE code verifier and challenge
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // Store verifier for later exchange (persists across OAuth redirect)
      storePkceVerifier(codeVerifier);

      const params: Record<string, string> = {
        code_challenge: codeChallenge,
      };
      if (redirectTo) {
        params.redirect_uri = redirectTo;
      }

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
          provider,
          codeVerifier, // Return verifier for manual flow (skipBrowserRedirect)
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
   * Exchange OAuth authorization code for tokens (PKCE flow)
   *
   * After OAuth callback redirects with an `insforge_code` parameter, call this method
   * to exchange it for access tokens. The code verifier is automatically
   * retrieved from sessionStorage if available.
   *
   * Note: This is called automatically by the SDK on initialization. You typically
   * don't need to call this directly unless using `skipBrowserRedirect: true`.
   *
   * @param code - The authorization code from OAuth callback URL
   * @param codeVerifier - Optional code verifier (auto-retrieved from sessionStorage if not provided)
   * @returns Session data with access token and user info
   *
   * @example
   * ```ts
   * // Automatic verifier retrieval (recommended for browser)
   * const params = new URLSearchParams(window.location.search);
   * const code = params.get('insforge_code');
   * if (code) {
   *   const { data, error } = await insforge.auth.exchangeOAuthCode(code);
   * }
   *
   * // Manual verifier (for custom flows)
   * const { data, error } = await insforge.auth.exchangeOAuthCode(code, codeVerifier);
   * ```
   */
  async exchangeOAuthCode(code: string, codeVerifier?: string): Promise<{
    data: { accessToken: string; user: UserSchema; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      // Try to get verifier from storage if not provided
      const verifier = codeVerifier ?? retrievePkceVerifier();

      if (!verifier) {
        return {
          data: null,
          error: new InsForgeError(
            'PKCE code verifier not found. Ensure signInWithOAuth was called in the same browser session.',
            400,
            'PKCE_VERIFIER_MISSING'
          )
        };
      }

      const request: OAuthCodeExchangeRequest = {
        code,
        code_verifier: verifier,
      };

      const response = await this.http.post<{
        accessToken: string;
        user: UserSchema;
        csrfToken?: string;
        redirectTo?: string;
      }>('/api/auth/oauth/exchange', request, { credentials: 'include' });

      // Save session
      if (!isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        if (response.csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(response.csrfToken);
        }
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(response.accessToken);
      }

      return {
        data: {
          accessToken: response.accessToken,
          user: response.user,
          redirectTo: response.redirectTo,
        },
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
          'An unexpected error occurred during OAuth code exchange',
          500,
          'UNEXPECTED_ERROR'
        )
      };
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<{ error: InsForgeError | null }> {
    try {
      // Try to call backend logout to clear httpOnly refresh cookie
      // This may fail for legacy backends, but that's ok
      try {
        await this.http.post('/api/auth/logout', undefined, { credentials: 'include' });
      } catch {
        // Ignore errors - legacy backend may not have this endpoint
      }

      // Clear local session and cookies
      this.tokenManager.clearSession();
      this.http.setAuthToken(null);
      clearCsrfToken();

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
   * Automatically waits for any pending OAuth callback to complete first
   */
  async getCurrentSession(): Promise<{
    data: { session: AuthSession | null };
    error: InsForgeError | null;
  }> {
    // Wait for any pending OAuth callback to complete (instant if none)
    await this.authCallbackHandled;

    // If hosted auth environment, return null
    if (isHostedAuthEnvironment()) {
      return { data: { session: null }, error: null };
    }

    try {
      // Step 1: Check if we already have session in memory
      const session = this.tokenManager.getSession();
      if (session) {
        this.http.setAuthToken(session.accessToken);
        // For edge function, we need to populate user data from the API
        if (!session.user || Object.keys(session.user).length === 0) {
          try {
            const authResponse = await this.http.get<GetCurrentSessionResponse>(
              '/api/auth/sessions/current',
              { credentials: 'include' }
            );
            if (authResponse.user) {
              session.user = authResponse.user;
              this.tokenManager.setUser(authResponse.user);
            }
          } catch {
            // Keep session without user if backend is unavailable
          }
        }
        return { data: { session }, error: null };
      }

      // Step 2: In browser, try to refresh using httpOnly cookie
      if (typeof window !== 'undefined') {
        try {
          const csrfToken = getCsrfToken();
          const response = await this.http.post<{
            accessToken: string;
            user?: UserSchema;
            csrfToken?: string
          }>(
            '/api/auth/refresh',
            undefined,
            {
              headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
              credentials: 'include',
            }
          );

          if (response.accessToken) {
            this.tokenManager.setMemoryMode();
            this.tokenManager.setAccessToken(response.accessToken);
            this.http.setAuthToken(response.accessToken);

            if (response.user) {
              this.tokenManager.setUser(response.user);
            }
            if (response.csrfToken) {
              setCsrfToken(response.csrfToken);
            }

            return {
              data: { session: this.tokenManager.getSession() },
              error: null
            };
          }
        } catch (error) {
          if (error instanceof InsForgeError) {
            if (error.statusCode === 404) {
              // Legacy backend - try localStorage
              this.tokenManager.setStorageMode();
              const session = this.tokenManager.getSession();
              if (session) {
                return { data: { session }, error: null };
              }
              return { data: { session: null }, error: null };
            }
            // 401/403 or other errors - not logged in
            return { data: { session: null }, error: error };
          }
        }
      }

      // Not logged in
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

      // Update the local session/user with the new profile data
      const currentUser = this.tokenManager.getUser();
      if (currentUser && response.profile !== undefined) {
        this.tokenManager.setUser({
          ...currentUser,
          profile: response.profile,
        });
      }

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
   * Resend email verification (code or link based on config)
   *
   * Resend email verification when the previous OTP has expired or was not received.
   * Uses the method configured in auth settings (verifyEmailMethod).
   * When method is 'code', sends a 6-digit numeric code. When method is 'link', sends a magic link.
   * Prevents user enumeration by returning success even if email doesn't exist.
   */
  async resendVerificationEmail(request: SendVerificationEmailRequest): Promise<{
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
   * @deprecated Use `resendVerificationEmail` instead. This method will be removed in a future version.
   */
  async sendVerificationEmail(request: SendVerificationEmailRequest): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    return this.resendVerificationEmail(request);
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
    data: VerifyEmailResponse | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<VerifyEmailResponse>(
        '/api/auth/email/verify',
        request,
        { credentials: 'include' }
      );

      // Save session if we got a token
      if (!isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        if (response.csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(response.csrfToken);
        }
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