/**
 * Token Manager for InsForge SDK
 * 
 * Simple token storage that supports two modes:
 * - Memory mode (new backend): tokens stored in memory only, more secure
 * - Storage mode (legacy backend): tokens persisted in localStorage
 */

import type { UserSchema } from '@insforge/shared-schemas';
import type { AuthSession, TokenStorage } from '../types';

// localStorage keys
export const TOKEN_KEY = 'insforge-auth-token';
export const USER_KEY = 'insforge-auth-user';

// Cookie flag to indicate user was logged in (for optimistic refresh)
export const AUTH_FLAG_COOKIE = 'isAuthenticated';

// CSRF token cookie name
export const CSRF_TOKEN_COOKIE = 'insforge_csrf_token';

/**
 * Check if isAuthenticated cookie exists
 */
export function hasAuthCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some(c =>
    c.trim().startsWith(`${AUTH_FLAG_COOKIE}=`)
  );
}

/**
 * Set isAuthenticated cookie
 */
export function setAuthCookie(): void {
  if (typeof document === 'undefined') return;
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  document.cookie = `${AUTH_FLAG_COOKIE}=true; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Clear isAuthenticated cookie
 */
export function clearAuthCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_FLAG_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Get CSRF token from cookie
 * Used to include in X-CSRF-Token header for refresh requests
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .find(c => c.trim().startsWith(`${CSRF_TOKEN_COOKIE}=`));
  if (!match) return null;
  return match.split('=')[1] || null;
}

/**
 * Set CSRF token cookie
 * Called after login/register/refresh to store the CSRF token
 */
export function setCsrfToken(token: string): void {
  if (typeof document === 'undefined') return;
  const maxAge = 7 * 24 * 60 * 60; // 7 days (same as refresh token)
  document.cookie = `${CSRF_TOKEN_COOKIE}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

/**
 * Clear CSRF token cookie
 * Called on logout
 */
export function clearCsrfToken(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${CSRF_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export class TokenManager {
  // In-memory storage
  private accessToken: string | null = null;
  private user: UserSchema | null = null;
  
  // Persistent storage (for legacy backend)
  private storage: TokenStorage;
  
  // Mode: 'memory' (new backend) or 'storage' (legacy backend, default)
  private _mode: 'memory' | 'storage' = 'storage';

  constructor(storage?: TokenStorage) {
    if (storage) {
      // Use provided storage
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      // Browser: use localStorage
      this.storage = window.localStorage;
    } else {
      // Node.js: use in-memory storage
      const store = new Map<string, string>();
      this.storage = {
        getItem: (key: string) => store.get(key) || null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); }
      };
    }
  }

  /**
   * Get current mode
   */
  get mode(): 'memory' | 'storage' {
    return this._mode;
  }

  /**
   * Set mode to memory (new backend with cookies + memory)
   */
  setMemoryMode(): void {
    if (this._mode === 'storage') {
      // Clear localStorage when switching from storage to memory mode
      this.storage.removeItem(TOKEN_KEY);
      this.storage.removeItem(USER_KEY);
    }
    this._mode = 'memory';
  }

  /**
   * Set mode to storage (legacy backend with localStorage)
   * Also loads existing session from localStorage
   */
  setStorageMode(): void {
    this._mode = 'storage';
    this.loadFromStorage();
  }

  /**
   * Load session from localStorage
   */
  private loadFromStorage(): void {
    const token = this.storage.getItem(TOKEN_KEY) as string | null;
    const userStr = this.storage.getItem(USER_KEY) as string | null;

    if (token && userStr) {
      try {
        this.accessToken = token;
        this.user = JSON.parse(userStr);
      } catch {
        this.clearSession();
      }
    }
  }

  /**
   * Save session (memory always, localStorage only in storage mode)
   */
  saveSession(session: AuthSession): void {
    this.accessToken = session.accessToken;
    this.user = session.user;

    // Persist to localStorage in storage mode
    if (this._mode === 'storage') {
      this.storage.setItem(TOKEN_KEY, session.accessToken);
      this.storage.setItem(USER_KEY, JSON.stringify(session.user));
    }
  }

  /**
   * Get current session
   */
  getSession(): AuthSession | null {
    if (!this.accessToken || !this.user) return null;
    return {
      accessToken: this.accessToken,
      user: this.user,
    };
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Set access token
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
    if (this._mode === 'storage') {
      this.storage.setItem(TOKEN_KEY, token);
    }
  }

  /**
   * Get user
   */
  getUser(): UserSchema | null {
    return this.user;
  }

  /**
   * Set user
   */
  setUser(user: UserSchema): void {
    this.user = user;
    if (this._mode === 'storage') {
      this.storage.setItem(USER_KEY, JSON.stringify(user));
    }
  }

  /**
   * Clear session (both memory and localStorage)
   */
  clearSession(): void {
    this.accessToken = null;
    this.user = null;
    this.storage.removeItem(TOKEN_KEY);
    this.storage.removeItem(USER_KEY);
  }

  /**
   * Check if there's a session in localStorage (for legacy detection)
   */
  hasStoredSession(): boolean {
    const token = this.storage.getItem(TOKEN_KEY);
    return !!token;
  }
}