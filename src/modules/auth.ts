/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

import { HttpClient } from '../lib/http-client';
import { TokenManager } from '../lib/token-manager';
import { AuthSession, InsForgeError } from '../types';
import { Database } from './database';

import type {
  CreateUserRequest,
  CreateUserResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetCurrentSessionResponse,
  GetOauthUrlResponse,
} from '@insforge/shared-schemas';

export class Auth {
  private database: Database;
  
  constructor(
    private http: HttpClient,
    private tokenManager: TokenManager
  ) {
    this.database = new Database(http);
    
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
      
      // Save session internally
      const session: AuthSession = {
        accessToken: response.accessToken,
        user: response.user,
      };
      this.tokenManager.saveSession(session);
      this.http.setAuthToken(response.accessToken);

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
        accessToken: response.accessToken,
        user: response.user,
      };
      this.tokenManager.saveSession(session);
      this.http.setAuthToken(response.accessToken);

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
    provider: 'google' | 'github';
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
   * Get the current user with full profile information
   * Returns both auth info (id, email, role) and profile data (nickname, avatar_url, bio, etc.)
   */
  async getCurrentUser(): Promise<{
    data: { user: any; profile: any } | null;
    error: InsForgeError | null;
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
      
      if (profileError && profileError.statusCode !== 406) {  // 406 = not found
        return { data: null, error: profileError };
      }
      
      return {
        data: {
          user: authResponse.user,
          profile: profile
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
   * Returns profile information from the users table (nickname, avatar_url, bio, etc.)
   */
  async getProfile(userId: string): Promise<{
    data: any | null;
    error: InsForgeError | null;
  }> {
    const { data, error } = await this.database
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    // Handle not found as null, not error
    if (error && error.statusCode === 406) {
      return { data: null, error: null };
    }
    
    return { data, error };
  }

  /**
   * Get the current session (only session data, no API call)
   * Returns the stored JWT token and basic user info from local storage
   */
  async getCurrentSession(): Promise<{
    data: { session: AuthSession | null };
    error: InsForgeError | null;
  }> {
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
   * Updates profile information in the users table (nickname, avatar_url, bio, etc.)
   */
  async setProfile(profile: {
    nickname?: string;
    avatar_url?: string;
    bio?: string;
    birthday?: string;
    [key: string]: any;
  }): Promise<{
    data: any | null;
    error: InsForgeError | null;
  }> {
    // Get current session to get user ID
    const session = this.tokenManager.getSession();
    if (!session?.user?.id) {
      return { 
        data: null, 
        error: new InsForgeError(
          'No authenticated user found',
          401,
          'UNAUTHENTICATED'
        )
      };
    }

    // Update the profile using query builder
    return await this.database
      .from('users')
      .update(profile)
      .eq('id', session.user.id)
      .select()
      .single();
  }


}