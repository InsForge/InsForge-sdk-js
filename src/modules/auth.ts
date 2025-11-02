/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

import { HttpClient } from '../lib/http-client';
import { TokenManager } from '../lib/token-manager';
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
 * Convert database profile (snake_case) to camelCase format
 * Handles dynamic fields flexibly - automatically converts all snake_case keys to camelCase
 */
function convertDbProfileToCamelCase(dbProfile: Record<string, any>): ProfileData {
  const result: ProfileData = {
    id: dbProfile.id,
  };
  
  // Convert known timestamp fields
  if (dbProfile.created_at !== undefined) result.createdAt = dbProfile.created_at;
  if (dbProfile.updated_at !== undefined) result.updatedAt = dbProfile.updated_at;
  
  // Convert all other fields from snake_case to camelCase dynamically
  Object.keys(dbProfile).forEach(key => {
    // Skip already processed fields
    if (key === 'id' || key === 'created_at' || key === 'updated_at') return;
    
    // Convert snake_case to camelCase
    // e.g., avatar_url -> avatarUrl, first_name -> firstName
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = dbProfile[key];
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

export class Auth {
  private database: Database;
  
  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager
  ) {
    this.database = new Database(http, tokenManager);
    
    // Auto-detect OAuth callback parameters in the URL
    this.detectOAuthCallback();
  }

  /**
   * Automatically detect and handle OAuth callback parameters in the URL
   * This runs on initialization to seamlessly complete the OAuth flow
   * Matches the backend's OAuth callback response (backend/src/api/routes/auth.ts:540-544)
   */
  private detectOAuthCallback(): void {
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
      this.tokenManager.saveSession(session);
      this.http.setAuthToken(response.accessToken || '');

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
   */
  async signOut(): Promise<{ error: InsForgeError | null }> {
    try {
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
          name: (data.profile as any)?.nickname || '', // Fallback - profile structure is dynamic
          emailVerified: false, // Not available from API, but required by UserSchema
          createdAt: new Date().toISOString(), // Fallback
          updatedAt: new Date().toISOString(), // Fallback
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
   * Send password reset code to user's email
   * Always returns success to prevent user enumeration
   */
  async sendPasswordResetCode(request: { email: string }): Promise<{
    data: { success: boolean; message: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ success: boolean; message: string }>(
        '/api/auth/email/send-reset-password-code',
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
   * Reset password with OTP token
   * Token can be from magic link or from code verification
   */
  async resetPassword(request: { newPassword: string; otp: string }): Promise<{
    data: { message: string; redirectTo?: string } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ message: string; redirectTo?: string }>(
        '/api/auth/reset-password',
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
   * Verify email with OTP token
   * If email is provided: uses numeric OTP verification (6-digit code)
   * If email is NOT provided: uses link OTP verification (64-char token)
   */
  async verifyEmail(request: { email?: string; otp: string }): Promise<{
    data: { accessToken: string; user?: any } | null;
    error: InsForgeError | null;
  }> {
    try {
      const response = await this.http.post<{ accessToken: string; user?: any }>(
        '/api/auth/verify-email',
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

  setSession(session: AuthSession): void {
    this.tokenManager.saveSession(session);
    this.http.setAuthToken(session.accessToken);
  }

}