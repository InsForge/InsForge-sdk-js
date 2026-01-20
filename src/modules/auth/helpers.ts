/**
 * Auth module helper functions
 */

import { InsForgeError } from '../../types';

// ============================================================================
// PKCE (Proof Key for Code Exchange) - RFC 7636
// ============================================================================

const PKCE_VERIFIER_KEY = 'insforge_pkce_verifier';

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
 * Generate a cryptographically random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate code challenge from verifier using SHA-256 (S256 method)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Store PKCE code verifier in sessionStorage
 */
export function storePkceVerifier(verifier: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  }
}

/**
 * Retrieve and clear PKCE code verifier from sessionStorage
 */
export function retrievePkceVerifier(): string | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (verifier) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  }
  return verifier;
}

// ============================================================================
// Environment & Error Helpers
// ============================================================================

/**
 * Check if current environment is a hosted auth environment
 * Returns true for:
 * - localhost with port 7130 (hosted auth app dev)
 * - https://*.insforge.app (hosted auth app production)
 */
export function isHostedAuthEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, port, protocol } = window.location;

  if (hostname === 'localhost' && port === '7130') {
    return true;
  }

  if (protocol === 'https:' && hostname.endsWith('.insforge.app')) {
    return true;
  }

  return false;
}

/**
 * Wrap an error into the standard { data, error } format
 * Passes through InsForgeError unchanged, wraps other errors
 */
export function wrapError<T>(
  error: unknown,
  fallbackMessage: string
): { data: T | null; error: InsForgeError } {
  if (error instanceof InsForgeError) {
    return { data: null, error };
  }

  return {
    data: null,
    error: new InsForgeError(
      error instanceof Error ? error.message : fallbackMessage,
      500,
      'UNEXPECTED_ERROR'
    ),
  };
}

/**
 * Clean up URL parameters (removes sensitive data from URL after OAuth callback)
 */
export function cleanUrlParams(...params: string[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  params.forEach((p) => url.searchParams.delete(p));
  window.history.replaceState({}, document.title, url.toString());
}
