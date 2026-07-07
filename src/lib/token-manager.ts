/**
 * Token Manager for InsForge SDK
 *
 * Memory-only token storage.
 */

import type { UserSchema } from '@insforge/shared-schemas';
import type { AuthSession } from '../types';

/**
 * Auth lifecycle events emitted when the stored credential changes.
 * - `signedIn` — a new session was established (login, OAuth, verify email).
 * - `signedOut` — the session was cleared.
 * - `tokenRefreshed` — the access token was replaced for the same session.
 *
 * Consumers (e.g. realtime) key off the event type instead of inspecting the
 * token, so the auth layer stays the single source of truth for intent.
 */
export type AuthChangeEvent = 'signedIn' | 'signedOut' | 'tokenRefreshed';

export type AuthStateChangeCallback = (event: AuthChangeEvent) => void;

// CSRF token cookie name
export const CSRF_TOKEN_COOKIE = 'insforge_csrf_token';

/**
 * Get CSRF token from cookie
 * Used to include in X-CSRF-Token header for refresh requests
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith(`${CSRF_TOKEN_COOKIE}=`));
  if (!match) {
    return null;
  }
  return match.split('=')[1] || null;
}

/**
 * Set CSRF token cookie
 * Called after login/register/refresh to store the CSRF token
 */
export function setCsrfToken(token: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const maxAge = 7 * 24 * 60 * 60; // 7 days (same as refresh token)
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CSRF_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Clear CSRF token cookie
 * Called on logout
 */
export function clearCsrfToken(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CSRF_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

export class TokenManager {
  // In-memory storage
  private accessToken: string | null = null;
  private user: UserSchema | null = null;

  // Auth state change subscribers (e.g. realtime keys off these to decide
  // between an in-band token refresh and a full reconnect)
  private authStateListeners = new Set<AuthStateChangeCallback>();

  constructor() {}

  /**
   * Subscribe to auth state changes. Returns an unsubscribe function.
   */
  onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    this.authStateListeners.add(callback);
    return () => {
      this.authStateListeners.delete(callback);
    };
  }

  private emitAuthStateChange(event: AuthChangeEvent): void {
    for (const callback of this.authStateListeners) {
      try {
        callback(event);
      } catch (err) {
        console.error('Error in auth state change listener:', err);
      }
    }
  }

  /**
   * Save session in memory
   *
   * @param event - The auth lifecycle event that caused the change. Defaults
   *   to `signedIn`; pass `tokenRefreshed` when replacing the token for an
   *   existing session so consumers don't treat it as a new identity.
   */
  saveSession(session: AuthSession, event: AuthChangeEvent = 'signedIn'): void {
    const tokenChanged = session.accessToken !== this.accessToken;
    this.accessToken = session.accessToken;
    this.user = session.user;

    if (tokenChanged) {
      this.emitAuthStateChange(event);
    }
  }

  /**
   * Get current session
   */
  getSession(): AuthSession | null {
    if (!this.accessToken || !this.user) {
      return null;
    }
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
   *
   * @param event - The auth lifecycle event. Defaults to `tokenRefreshed`,
   *   since bare token replacement is dominated by refresh/hydration; pass
   *   `signedIn` when this represents a new identity.
   */
  setAccessToken(token: string, event: AuthChangeEvent = 'tokenRefreshed'): void {
    const tokenChanged = token !== this.accessToken;
    this.accessToken = token;
    if (tokenChanged) {
      this.emitAuthStateChange(event);
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

    if (hadToken) {
      this.emitAuthStateChange('signedOut');
    }
  }
}
