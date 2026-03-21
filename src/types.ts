/**
 * InsForge SDK Types - only SDK-specific types here
 * Use @insforge/shared-schemas directly for API types
 */

import type { UserSchema } from '@insforge/shared-schemas';

export interface InsForgeConfig {
  /**
   * The base URL of the InsForge backend API
   * @default "http://localhost:7130"
   */
  baseUrl?: string;

  /**
   * Anonymous API key (optional)
   * Used for public/unauthenticated requests when no user token is set
   */
  anonKey?: string;

  /**
   * Edge Function Token (optional)
   * Use this when running in edge functions/serverless with a user's JWT token
   * This token will be used for all authenticated requests
   */
  edgeFunctionToken?: string;

  /**
   * Direct URL to Deno Subhosting functions (optional)
   * When provided, SDK will try this URL first for function invocations.
   * Falls back to proxy URL if subhosting returns 404.
   * @example "https://{appKey}.functions.insforge.app"
   */
  functionsUrl?: string;

  /**
   * Custom fetch implementation (useful for Node.js environments)
   */
  fetch?: typeof fetch;

  /**
   * Enable server-side auth mode (SSR/Node runtime)
   * In this mode auth endpoints use `client_type=mobile` and refresh_token body flow.
   * @default false
   */
  isServerMode?: boolean;

  /**
   * Custom headers to include with every request
   */
  headers?: Record<string, string>;

  /**
   * Enable debug logging for HTTP requests and responses.
   * When true, request/response details are logged to the console.
   * Can also be a custom log function for advanced use cases.
   * @default false
   */
  debug?: boolean | ((message: string, ...args: any[]) => void);

  /**
   * Request timeout in milliseconds.
   * Requests that exceed this duration will be aborted.
   * Set to 0 to disable timeout.
   * @default 30000
   */
  timeout?: number;

  /**
   * Maximum number of retry attempts for failed requests.
   * Retries are triggered on network errors and server errors (5xx).
   * Client errors (4xx) are never retried.
   * Set to 0 to disable retries.
   * @default 3
   */
  retryCount?: number;

  /**
   * Initial delay in milliseconds before the first retry.
   * The delay doubles with each subsequent attempt (exponential backoff)
   * with ±15% jitter to prevent thundering herd.
   * @default 500
   */
  retryDelay?: number;

  /**
   * Automatically refresh the access token when a request fails with 401 INVALID_TOKEN.
   * When true, the SDK will attempt a token refresh and retry the original request.
   * @default true
   */
  autoRefreshToken?: boolean;
}

export interface AuthSession {
  user: UserSchema;
  accessToken: string;
  expiresAt?: Date;
}

export interface AuthRefreshResponse {
  user: UserSchema;
  accessToken: string;
  csrfToken?: string;
  refreshToken?: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  nextActions?: string;
}

export class InsForgeError extends Error {
  public statusCode: number;
  public error: string;
  public nextActions?: string;

  constructor(
    message: string,
    statusCode: number,
    error: string,
    nextActions?: string,
  ) {
    super(message);
    this.name = 'InsForgeError';
    this.statusCode = statusCode;
    this.error = error;
    this.nextActions = nextActions;
  }

  static fromApiError(apiError: ApiError): InsForgeError {
    return new InsForgeError(
      apiError.message,
      apiError.statusCode,
      apiError.error,
      apiError.nextActions,
    );
  }
}
