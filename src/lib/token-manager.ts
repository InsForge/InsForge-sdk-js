/**
 * Token Manager for InsForge SDK
 *
 * Memory-only token storage.
 */

import type { UserSchema } from '@insforge/shared-schemas';
import type { AuthSession } from '../types';

// CSRF token cookie name
export const CSRF_TOKEN_COOKIE = 'insforge_csrf_token';

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
  const secure = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? '; Secure' : '';
  document.cookie = `${CSRF_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Clear CSRF token cookie
 * Called on logout
 */
export function clearCsrfToken(): void {
  if (typeof document === 'undefined') return;
  const secure = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? '; Secure' : '';
  document.cookie = `${CSRF_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

export class TokenManager {
  // In-memory storage
  private accessToken: string | null = null;
  private user: UserSchema | null = null;

  // Callback for token changes (used by realtime to reconnect with new token)
  onTokenChange: (() => void) | null = null;

  constructor() {}

  /**
   * Save session in memory
   */
  saveSession(session: AuthSession): void {
    const tokenChanged = session.accessToken !== this.accessToken;
    this.accessToken = session.accessToken;
    this.user = session.user;

    if (tokenChanged && this.onTokenChange) {
      this.onTokenChange();
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
    const tokenChanged = token !== this.accessToken;
    this.accessToken = token;
    if (tokenChanged && this.onTokenChange) {
      this.onTokenChange();
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
  }

  /**
   * Clear in-memory session
   */
  clearSession(): void {
    const hadToken = this.accessToken !== null;
    this.accessToken = null;
    this.user = null;

    if (hadToken && this.onTokenChange) {
      this.onTokenChange();
    }
  }
}
