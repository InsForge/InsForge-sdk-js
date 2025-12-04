import { TokenStorage, AuthSession } from '../types';
import type { UserSchema } from '@insforge/shared-schemas';
import type { StorageMode } from './version-detector';

// localStorage keys for legacy mode
const TOKEN_KEY = 'insforge-auth-token';
const USER_KEY = 'insforge-auth-user';

// Cookie name for optimistic refresh flag (modern mode)
const AUTH_FLAG_COOKIE = 'isAuthenticated';

/**
 * Dual-mode TokenManager for InsForge SDK
 * 
 * Supports two storage modes:
 * - 'modern': Access token in memory + refresh token in httpOnly cookie (XSS-safe)
 * - 'legacy': Tokens stored in localStorage (backward compatible with old backends)
 * 
 * The mode is determined by detecting the backend version at initialization.
 */
export class TokenManager {
  private mode: StorageMode = 'legacy'; // Default to legacy for safety
  private accessToken: string | null = null;
  private user: UserSchema | null = null;
  private storage: TokenStorage | null = null;

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
   * Set the storage mode based on detected backend capabilities
   * If switching to modern mode, migrate any existing localStorage session to memory
   */
  setMode(mode: StorageMode): void {
    const previousMode = this.mode;
    this.mode = mode;
    
    // If switching to modern mode and we have legacy data, migrate it
    if (mode === 'modern' && previousMode === 'legacy' && this.storage) {
      const legacyToken = this.storage.getItem(TOKEN_KEY);
      const legacyUserStr = this.storage.getItem(USER_KEY);
      
      if (legacyToken && legacyUserStr) {
        try {
          this.accessToken = legacyToken as string;
          this.user = JSON.parse(legacyUserStr as string);
          // Clear legacy storage after migration
          this.storage.removeItem(TOKEN_KEY);
          this.storage.removeItem(USER_KEY);
          // Set auth flag cookie for modern mode
          this.setAuthFlag(true);
          console.info('[InsForge] Migrated session from localStorage to memory.');
        } catch {
          // Invalid JSON, clear it
          this.storage.removeItem(TOKEN_KEY);
          this.storage.removeItem(USER_KEY);
        }
      }
    }
  }

  /**
   * Get the current storage mode
   */
  getMode(): StorageMode {
    return this.mode;
  }

  /**
   * Save session data
   * In modern mode: stores in memory + sets auth flag cookie
   * In legacy mode: stores in localStorage
   */
  saveSession(session: AuthSession): void {
    this.accessToken = session.accessToken;
    this.user = session.user;
    
    if (this.mode === 'modern') {
      // Modern: only store in memory + set flag cookie
      this.setAuthFlag(true);
    } else {
      // Legacy: store in localStorage
      this.storage?.setItem(TOKEN_KEY, session.accessToken);
      this.storage?.setItem(USER_KEY, JSON.stringify(session.user));
    }
  }

  /**
   * Get current session
   * In modern mode: returns from memory
   * In legacy mode: reads from localStorage
   */
  getSession(): AuthSession | null {
    if (this.mode === 'modern') {
      // Modern: return from memory
      if (!this.accessToken) return null;
      return { 
        accessToken: this.accessToken, 
        user: this.user! 
      };
    } else {
      // Legacy: read from localStorage
      const token = this.storage?.getItem(TOKEN_KEY);
      const userStr = this.storage?.getItem(USER_KEY);

      if (!token || !userStr) {
        return null;
      }

      try {
        const user = JSON.parse(userStr as string);
        return { accessToken: token as string, user };
      } catch {
        this.clearSession();
        return null;
      }
    }
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    if (this.mode === 'modern') {
      return this.accessToken;
    } else {
      const token = this.storage?.getItem(TOKEN_KEY);
      return typeof token === 'string' ? token : null;
    }
  }

  /**
   * Get user data
   */
  getUser(): UserSchema | null {
    if (this.mode === 'modern') {
      return this.user;
    } else {
      const userStr = this.storage?.getItem(USER_KEY);
      if (!userStr) return null;
      try {
        return JSON.parse(userStr as string);
      } catch {
        return null;
      }
    }
  }

  /**
   * Update access token only (used after refresh)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
    if (this.mode === 'legacy' && this.storage) {
      this.storage.setItem(TOKEN_KEY, token);
    }
  }

  /**
   * Update user data
   */
  setUser(user: UserSchema): void {
    this.user = user;
    if (this.mode === 'legacy' && this.storage) {
      this.storage.setItem(USER_KEY, JSON.stringify(user));
    }
  }

  /**
   * Clear session data
   * In modern mode: clears memory + auth flag cookie
   * In legacy mode: clears localStorage
   */
  clearSession(): void {
    this.accessToken = null;
    this.user = null;
    
    if (this.mode === 'modern') {
      this.setAuthFlag(false);
    } else {
      this.storage?.removeItem(TOKEN_KEY);
      this.storage?.removeItem(USER_KEY);
    }
  }

  /**
   * Check if we should attempt token refresh
   * Only applicable in modern mode:
   * Returns true if isAuthenticated flag exists but no access token in memory
   * (indicates page refresh - need to restore session via refresh token)
   */
  shouldAttemptRefresh(): boolean {
    // Only applicable in modern mode
    if (this.mode !== 'modern') return false;
    // If we already have token in memory, no need to refresh
    if (this.accessToken) return false;
    // Check if auth flag cookie exists
    return this.hasAuthFlag();
  }

  // --- Auth Flag Cookie Methods (Modern Mode Only) ---

  /**
   * Set or clear the isAuthenticated flag cookie
   * This is an optimistic flag that tells the SDK to attempt refresh on page load
   */
  private setAuthFlag(authenticated: boolean): void {
    if (typeof document === 'undefined') return;
    
    if (authenticated) {
      const maxAge = 7 * 24 * 60 * 60; // 7 days
      document.cookie = `${AUTH_FLAG_COOKIE}=true; path=/; max-age=${maxAge}; SameSite=Lax`;
    } else {
      document.cookie = `${AUTH_FLAG_COOKIE}=; path=/; max-age=0`;
    }
  }

  /**
   * Check if isAuthenticated flag cookie exists
   */
  private hasAuthFlag(): boolean {
    if (typeof document === 'undefined') return false;
    return document.cookie.includes(`${AUTH_FLAG_COOKIE}=true`);
  }
}
