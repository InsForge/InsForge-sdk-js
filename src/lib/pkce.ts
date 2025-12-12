/**
 * PKCE (Proof Key for Code Exchange) Implementation
 * 
 * Used for secure OAuth authorization code flow, preventing
 * authorization code interception attacks.
 */

const PKCE_VERIFIER_KEY = 'insforge_pkce_code_verifier';

/**
 * Generate a cryptographically random code verifier for PKCE
 * @returns Base64URL encoded random string (43-128 characters)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generate code challenge from code verifier using SHA-256
 * @param verifier - The code verifier string
 * @returns Base64URL encoded SHA-256 hash
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64URL encode (RFC 4648)
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
 * Retrieve and remove PKCE code verifier from sessionStorage (one-time use)
 */
export function consumePkceVerifier(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (verifier) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  }
  return verifier;
}

/**
 * Generate PKCE pair and store verifier in sessionStorage
 * @returns code_challenge to send to backend
 */
export async function generateAndStorePkce(): Promise<string> {
  const verifier = generateCodeVerifier();
  storePkceVerifier(verifier);
  return generateCodeChallenge(verifier);
}
