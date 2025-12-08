/**
 * Session Storage Strategies for InsForge SDK
 * 
 * Implements the Strategy Pattern for token storage:
 * - SecureSessionStorage: In-memory tokens + httpOnly cookie refresh (XSS-resistant)
 * - PersistentSessionStorage: localStorage-based storage (legacy/fallback)
 */

import type { UserSchema } from '@insforge/shared-schemas';
import type { AuthSession, TokenStorage } from '../types';

// localStorage keys for persistent storage
const TOKEN_KEY = 'insforge-auth-token';
const USER_KEY = 'insforge-auth-user';

// Cookie name for optimistic refresh flag
const AUTH_FLAG_COOKIE = 'isAuthenticated';

/**
 * Strategy interface for session storage
 * All storage implementations must conform to this interface
 */
export interface SessionStorageStrategy {
  /** Save complete session (token + user) */
  saveSession(session: AuthSession): void;
  
  /** Get current session */
  getSession(): AuthSession | null;
  
  /** Get access token only */
  getAccessToken(): string | null;
  
  /** Update access token (e.g., after refresh) */
  setAccessToken(token: string): void;
  
  /** Get user data */
  getUser(): UserSchema | null;
  
  /** Update user data */
  setUser(user: UserSchema): void;
  
  /** Clear all session data */
  clearSession(): void;
  
  /** Check if token refresh should be attempted (e.g., on page reload) */
  shouldAttemptRefresh(): boolean;
  
  /** Get strategy identifier for debugging */
  readonly strategyId: string;
}

/**
 * Secure Session Storage Strategy
 * 
 * Stores access token in memory only (cleared on page refresh).
 * Refresh token is stored in httpOnly cookie by the backend.
 * Uses an 'isAuthenticated' flag cookie to detect if refresh should be attempted.
 * 
 * Security benefits:
 * - Access token not accessible to XSS attacks (in memory only)
 * - Refresh token completely inaccessible to JavaScript (httpOnly)
 */
export class SecureSessionStorage implements SessionStorageStrategy {
  readonly strategyId = 'secure';
  
  private accessToken: string | null = null;
  private user: UserSchema | null = null;

  saveSession(session: AuthSession): void {
    this.accessToken = session.accessToken;
    this.user = session.user;
    this.setAuthFlag(true);
  }

  getSession(): AuthSession | null {
    if (!this.accessToken) return null;
    return {
      accessToken: this.accessToken,
      user: this.user!,
    };
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  getUser(): UserSchema | null {
    return this.user;
  }

  setUser(user: UserSchema): void {
    this.user = user;
  }

  clearSession(): void {
    this.accessToken = null;
    this.user = null;
    this.setAuthFlag(false);
  }

  shouldAttemptRefresh(): boolean {
    // Attempt refresh if:
    // 1. No token in memory (page was refreshed)
    // 2. Auth flag cookie exists (user was previously authenticated)
    if (this.accessToken) return false;
    return this.hasAuthFlag();
  }

  // --- Private: Auth Flag Cookie Management ---

  private setAuthFlag(authenticated: boolean): void {
    if (typeof document === 'undefined') return;

    if (authenticated) {
      const maxAge = 7 * 24 * 60 * 60; // 7 days
      document.cookie = `${AUTH_FLAG_COOKIE}=true; path=/; max-age=${maxAge}; SameSite=Lax`;
    } else {
      document.cookie = `${AUTH_FLAG_COOKIE}=; path=/; max-age=0`;
    }
  }

  private hasAuthFlag(): boolean {
    if (typeof document === 'undefined') return false;
    return document.cookie.includes(`${AUTH_FLAG_COOKIE}=true`);
  }
}

/**
 * Persistent Session Storage Strategy
 * 
 * Stores tokens in localStorage for persistence across page reloads.
 * Used for legacy backends or environments where httpOnly cookies aren't available.
 * 
 * Note: This approach exposes tokens to XSS attacks. Use SecureSessionStorage
 * when possible.
 */
export class PersistentSessionStorage implements SessionStorageStrategy {
  readonly strategyId = 'persistent';
  
  private storage: TokenStorage;

  constructor(storage?: TokenStorage) {
    if (storage) {
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      // Fallback: in-memory storage for Node.js environments
      const store = new Map<string, string>();
      this.storage = {
        getItem: (key: string) => store.get(key) || null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      };
    }
  }

  saveSession(session: AuthSession): void {
    this.storage.setItem(TOKEN_KEY, session.accessToken);
    this.storage.setItem(USER_KEY, JSON.stringify(session.user));
  }

  getSession(): AuthSession | null {
    const token = this.storage.getItem(TOKEN_KEY);
    const userStr = this.storage.getItem(USER_KEY);

    if (!token || !userStr) return null;

    try {
      const user = JSON.parse(userStr as string);
      return { accessToken: token as string, user };
    } catch {
      this.clearSession();
      return null;
    }
  }

  getAccessToken(): string | null {
    const token = this.storage.getItem(TOKEN_KEY);
    return typeof token === 'string' ? token : null;
  }

  setAccessToken(token: string): void {
    this.storage.setItem(TOKEN_KEY, token);
  }

  getUser(): UserSchema | null {
    const userStr = this.storage.getItem(USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr as string);
    } catch {
      return null;
    }
  }

  setUser(user: UserSchema): void {
    this.storage.setItem(USER_KEY, JSON.stringify(user));
  }

  clearSession(): void {
    this.storage.removeItem(TOKEN_KEY);
    this.storage.removeItem(USER_KEY);
  }

  shouldAttemptRefresh(): boolean {
    // In persistent mode, we always have the token in storage
    // No need to refresh on page load
    return false;
  }
}
