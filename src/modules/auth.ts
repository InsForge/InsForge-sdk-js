/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

import { HttpClient } from '../lib/http-client';
import { TokenManager, getCsrfToken, setCsrfToken, clearCsrfToken } from '../lib/token-manager';
import { consumePkceVerifier, generateAndStorePkce } from '../lib/pkce';
import { AuthSession, InsForgeError } from '../types';
import { Database } from './database-postgrest';

import type {
  CreateUserRequest,
  CreateUserResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetCurrentSessionResponse,
  GetOauthUrlResponse,
  GetPublicAuthConfigResponse,
  OAuthProvidersSchema,
  UserIdSchema,
  EmailSchema,
  RoleSchema,
  SendVerificationEmailRequest,
  SendResetPasswordEmailRequest,
  ExchangeResetPasswordTokenRequest,
  VerifyEmailRequest,
} from '@insforge/shared-schemas';

/**
 * Dynamic profile type - represents flexible profile data from database
 * Fields can vary based on database schema configuration.
 * All fields are converted from snake_case (database) to camelCase (API)
 */
export type ProfileData = Record<string, any> & {
  id: string; // User ID (required)
  createdAt?: string; // PostgreSQL TIMESTAMPTZ
  updatedAt?: string; // PostgreSQL TIMESTAMPTZ
};

/**
 * Dynamic profile update type - for updating profile fields
 * Supports any fields that exist in the profile table
 */
export type UpdateProfileData = Partial<Record<string, any>>;

/**
 * Convert database profile to include both snake_case and camelCase formats
 * Handles dynamic fields flexibly - automatically converts all snake_case keys to camelCase
 * 
 * NOTE: Backward compatibility for <= v0.0.57
 * Both formats are returned to maintain compatibility with existing code.
 * For example: both created_at and createdAt are included in the result.
 */
function convertDbProfileToCamelCase(dbProfile: Record<string, any>): ProfileData {
  const result: ProfileData = {
    id: dbProfile.id,
  };

  // Convert all fields - keep both snake_case and camelCase for backward compatibility (<= v0.0.57)
  Object.keys(dbProfile).forEach(key => {

    // Keep original field (snake_case) for backward compatibility (<= v0.0.57)
    result[key] = dbProfile[key];

    // Also add camelCase version if field contains underscore
    // e.g., created_at -> createdAt, avatar_url -> avatarUrl, etc.
    if (key.includes('_')) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = dbProfile[key];
    }
  });

  return result;
}

/**
 * Convert camelCase profile data to database format (snake_case)
 * Handles dynamic fields flexibly - automatically converts all camelCase keys to snake_case
 */
function convertCamelCaseToDbProfile(profile: UpdateProfileData): Record<string, any> {
  const dbProfile: Record<string, any> = {};

  Object.keys(profile).forEach(key => {
    if (profile[key] === undefined) return;

    // Convert camelCase to snake_case
    // e.g., avatarUrl -> avatar_url, firstName -> first_name
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    dbProfile[snakeKey] = profile[key];
  });

  return dbProfile;
}

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
  private database: Database;

  // Promise for ongoing code exchange (started immediately on detection)
  private _exchangeCodePromise: Promise<boolean> | null = null;

  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager
  ) {
    this.database = new Database(http, tokenManager);

    // Auto-detect OAuth callback parameters in the URL
    this.detectAuthCallback();
  }

  /**
 * Restore session on app initialization
 * 
 * @returns Object with isLoggedIn status
 * 
 * @example
 * ```typescript
 * const client = new InsForgeClient({ baseUrl: '...' });
 * const { isLoggedIn } = await client.auth.restoreSession();
 * 
 * if (isLoggedIn) {
 *   const { data } = await client.auth.getCurrentUser();
 * }
 * ```
 */
  async restoreSession(): Promise<{
    isLoggedIn: boolean;
  }> {
    // Skip in non-browser environment
    if (typeof window === 'undefined') {
      return { isLoggedIn: false };
    }

    // Step 1: If we already have a token in memory (e.g., from OAuth callback), we're done
    if (this.tokenManager.getAccessToken()) {
      return { isLoggedIn: true };
    }

    // Step 2: Try to refresh using httpOnly cookie
    try {
      // Include CSRF token in header for CSRF protection
      const csrfToken = getCsrfToken();
      const response = await this.http.post<{ accessToken: string; user?: any; csrfToken?: string }>(
        '/api/auth/refresh',
        undefined,
        {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
          credentials: 'include',
        }
      );

      if (response.accessToken) {
        // Refresh successful - this is new backend, switch to memory mode
        // This clears localStorage and stores token only in memory (more secure)
        this.tokenManager.setMemoryMode();
        this.tokenManager.setAccessToken(response.accessToken);
        this.http.setAuthToken(response.accessToken);
        if (response.user) {
          this.tokenManager.setUser(response.user);
        }
        // Update CSRF token for next refresh
        if (response.csrfToken) {
          setCsrfToken(response.csrfToken);
        }
        return { isLoggedIn: true };
      }
    } catch (error) {
      if (error instanceof InsForgeError) {
        if (error.statusCode === 404) {
          // Legacy backend (no refresh endpoint) - stay in storage mode
          // Try to load session from localStorage
          this.tokenManager.setStorageMode();
          const token = this.tokenManager.getAccessToken();
          if (token) {
            this.http.setAuthToken(token);
            return { isLoggedIn: true };
          }
          return { isLoggedIn: false };
        }

        if (error.statusCode === 401 || error.statusCode === 403) {
          // New backend but session expired or CSRF failed - clear cookies
          this.tokenManager.setMemoryMode();
          clearCsrfToken();
          return { isLoggedIn: false };
        }
      }
      // Other errors - not logged in
      return { isLoggedIn: false };
    }

    // Default: not logged in
    return { isLoggedIn: false };
  }

  /**
   * Automatically detect and handle auth callback parameters in the URL
   * 
   * Handles two scenarios:
   * 1. code: New PKCE flow - exchange code + code_verifier for tokens
   * 2. access_token (legacy): Direct token in URL (backward compatibility)
   */
  private detectAuthCallback(): void {
    // Only run in browser environment
    if (typeof window === 'undefined') return;

    try {
      const params = new URLSearchParams(window.location.search);
      
      // New PKCE flow: authorization code
      const authCode = params.get('code');
      if (authCode) {
        this.exchangeAuthorizationCode(authCode);
        return;
      }

      // Legacy flow: access_token directly in URL (backward compatibility)
      const accessToken = params.get('access_token');
      const userId = params.get('user_id');
      const email = params.get('email');
      const name = params.get('name');
      const csrfToken = params.get('csrf_token');

      // Check if we have OAuth callback parameters
      if (accessToken && userId && email) {
        if (csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(csrfToken);
        }
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

        // Clean up the URL
        this.cleanupAuthCallbackUrl();
      }
    } catch (error) {
      console.debug('Auth callback detection skipped:', error);
    }
  }

  /**
   * Exchange authorization code for access token using PKCE
   * Called when authorization code is detected in URL
   */
  private async exchangeAuthorizationCode(authorizationCode: string): Promise<void> {
    try {
      // Get code_verifier from sessionStorage (if available)
      const codeVerifier = consumePkceVerifier();

      // Call exchange endpoint
      const response = await this.http.post<{
        accessToken: string;
        user: any;
        csrfToken?: string;
      }>('/api/auth/exchange', {
        code: authorizationCode,
        code_verifier: codeVerifier, // May be null for hosted auth scenario
      });

      if (response.accessToken && response.user) {
        // Set memory mode if we have CSRF token (new secure mode)
        if (response.csrfToken) {
          this.tokenManager.setMemoryMode();
          setCsrfToken(response.csrfToken);
        }

        // Save session
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        this.http.setAuthToken(response.accessToken);
        this.tokenManager.saveSession(session);
      }

      // Clean up the URL
      this.cleanupAuthCallbackUrl();
    } catch (error) {
      console.error('Failed to exchange session code:', error);
      // Clean up URL even on error
      this.cleanupAuthCallbackUrl();
    }
  }

  /**
   * Clean up auth callback parameters from URL
   */
  private cleanupAuthCallbackUrl(): void {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    // Remove all auth-related params
    url.searchParams.delete('code');
    url.searchParams.delete('access_token');
    url.searchParams.delete('user_id');
    url.searchParams.delete('email');
    url.searchParams.delete('name');
    url.searchParams.delete('csrf_token');
    url.searchParams.delete('error');

    window.history.replaceState({}, document.title, url.toString());
  }

  /**
   * Sign up a new user
   * Supports PKCE: if codeChallenge is provided, returns authorization code instead of saving session locally
   */
  async signUp(request: CreateUserRequest & { codeChallenge?: string }): Promise<{
    data: CreateUserResponse & { code?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const { codeChallenge, ...baseRequest } = request;
      const body = codeChallenge 
        ? { ...baseRequest, code_challenge: codeChallenge }
        : baseRequest;

      const response = await this.http.post<CreateUserResponse & { csrfToken?: string; code?: string }>(
        '/api/auth/users', 
        body
      );

      // For PKCE flow (code returned), don't save session locally
      if (!response.code && response.accessToken && response.user && !isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(response.accessToken);

        if (response.csrfToken) {
          setCsrfToken(response.csrfToken);
        }
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
   * Supports PKCE: if codeChallenge is provided, returns authorization code instead of saving session locally
   */
  async signInWithPassword(request: CreateSessionRequest & { codeChallenge?: string }): Promise<{
    data: CreateSessionResponse & { csrfToken?: string; code?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const { codeChallenge, ...baseRequest } = request;
      const body = codeChallenge 
        ? { ...baseRequest, code_challenge: codeChallenge }
        : baseRequest;

      const response = await this.http.post<CreateSessionResponse & { csrfToken?: string; code?: string }>(
        '/api/auth/sessions', 
        body
      );

      // For PKCE flow (code returned), don't save session locally
      // The session will be established after code exchange in user's app
      if (!response.code && response.accessToken && response.user && !isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(response.accessToken);

        if (response.csrfToken) {
          setCsrfToken(response.csrfToken);
        }
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
   * 
   * For non-hosted environments, PKCE is used for security:
   * 1. Generate code_verifier and code_challenge
   * 2. Store code_verifier in sessionStorage
   * 3. Send code_challenge to backend
   * 4. After OAuth callback, use code_verifier to exchange authorization code for tokens
   */
  async signInWithOAuth(options: {
    provider: OAuthProvidersSchema;
    redirectTo?: string;
    skipBrowserRedirect?: boolean;
    codeChallenge?: string; // Pre-generated code_challenge (for hosted auth scenario)
  }): Promise<{
    data: { url?: string; provider?: string };
    error: InsForgeError | null;
  }> {
    try {
      const { provider, redirectTo, skipBrowserRedirect, codeChallenge } = options;

      const params: Record<string, string> = {
        support_code: 'true',
      };
      if (redirectTo) {
        params.redirect_uri = redirectTo;
      }

      // Add PKCE code_challenge
      // If codeChallenge is provided (from hosted auth button), use it
      // Otherwise generate new PKCE pair for direct SDK usage
      if (codeChallenge) {
        params.code_challenge = codeChallenge;
        params.code_challenge_method = 'S256';
      } else if (!isHostedAuthEnvironment()) {
        // Generate PKCE for non-hosted environments
        const challenge = await generateAndStorePkce();
        params.code_challenge = challenge;
        params.code_challenge_method = 'S256';
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
   * Get the current user with full profile information
   * Returns both auth info (id, email, role) and profile data (dynamic fields from users table)
   */
  async getCurrentUser(): Promise<{
    data: {
      user: {
        id: UserIdSchema;
        email: EmailSchema;
        role: RoleSchema;
      };
      profile: ProfileData | null;
    } | null;
    error: any | null;
  }> {
    try {
      // Check if we have a token
      const session = this.tokenManager.getSession();
      if (!session?.accessToken) {
        return { data: null, error: null };
      }

      // Call the API for auth info
      this.http.setAuthToken(session.accessToken);
      const authResponse = await this.http.get<GetCurrentSessionResponse>('/api/auth/sessions/current');

      // Get the user's profile using query builder
      const { data: profile, error: profileError } = await this.database
        .from('users')
        .select('*')
        .eq('id', authResponse.user.id)
        .single();

      // For database errors, return PostgrestError directly
      if (profileError && (profileError as any).code !== 'PGRST116') {  // PGRST116 = not found
        return { data: null, error: profileError };
      }

      return {
        data: {
          user: authResponse.user,
          profile: profile ? convertDbProfileToCamelCase(profile) : null
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
   * Returns profile information from the users table (dynamic fields)
   */
  async getProfile(userId: string): Promise<{
    data: ProfileData | null;
    error: any | null;
  }> {
    const { data, error } = await this.database
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Handle not found as null, not error
    if (error && (error as any).code === 'PGRST116') {
      return { data: null, error: null };
    }

    // Convert database format to camelCase format
    if (data) {
      return { data: convertDbProfileToCamelCase(data), error: null };
    }

    // Return PostgrestError directly for database operations
    return { data: null, error };
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
   */
  async setProfile(profile: UpdateProfileData): Promise<{
    data: ProfileData | null;
    error: any | null;
  }> {
    // Get current session to get user ID
    const session = this.tokenManager.getSession();
    if (!session?.accessToken) {
      return {
        data: null,
        error: new InsForgeError(
          'No authenticated user found',
          401,
          'UNAUTHENTICATED'
        )
      };
    }

    // If no user ID in session (edge function scenario), fetch it
    if (!session.user?.id) {
      const { data, error } = await this.getCurrentUser();
      if (error) {
        return { data: null, error };
      }
      if (data?.user) {
        // Update session with minimal user info
        session.user = {
          id: data.user.id,
          email: data.user.email,
          name: '',
          emailVerified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.tokenManager.saveSession(session);
      }
    }

    // Convert camelCase format to database format (snake_case)
    const dbProfile = convertCamelCaseToDbProfile(profile);

    // Update the profile using query builder
    const { data, error } = await this.database
      .from('users')
      .update(dbProfile)
      .eq('id', session.user.id)
      .select()
      .single();

    // Convert database format back to camelCase format
    if (data) {
      return { data: convertDbProfileToCamelCase(data), error: null };
    }

    // Return PostgrestError directly for database operations
    return { data: null, error };
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
   * Supports PKCE: if codeChallenge is provided, returns authorization code instead of saving session locally
   *
   * The email verification link sent to users always points to the backend API endpoint.
   * If `verifyEmailRedirectTo` is configured, the backend will redirect to that URL after successful verification.
   * Otherwise, a default success page is displayed.
   */
  async verifyEmail(request: VerifyEmailRequest & { codeChallenge?: string }): Promise<{
    data: { accessToken?: string; code?: string; user?: any; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const { codeChallenge, ...baseRequest } = request;
      const body = codeChallenge 
        ? { ...baseRequest, code_challenge: codeChallenge }
        : baseRequest;

      const response = await this.http.post<{ 
        accessToken: string; 
        user?: any; 
        redirectTo?: string; 
        csrfToken?: string;
        code?: string;
      }>(
        '/api/auth/email/verify',
        body
      );

      // For PKCE flow (code returned), don't save session locally
      if (!response.code && response.accessToken && response.user && !isHostedAuthEnvironment()) {
        const session: AuthSession = {
          accessToken: response.accessToken,
          user: response.user,
        };
        this.tokenManager.setStorageMode();
        this.tokenManager.saveSession(session);
        this.http.setAuthToken(response.accessToken);

        if (response.csrfToken) {
          setCsrfToken(response.csrfToken);
        }
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
