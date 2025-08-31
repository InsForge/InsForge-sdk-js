/**
 * InsForge SDK Types - only SDK-specific types here
 * Use @insforge/shared-schemas directly for API types
 */

import type { UserSchema } from '@insforge/shared-schemas';

export interface InsForgeConfig {
  /**
   * The URL of the InsForge backend API
   * @default "http://localhost:7130"
   */
  url?: string;

  /**
   * API key (optional)
   * Can be used for server-side operations or specific use cases
   */
  apiKey?: string;

  /**
   * Custom fetch implementation (useful for Node.js environments)
   */
  fetch?: typeof fetch;

  /**
   * Storage adapter for persisting tokens
   */
  storage?: TokenStorage;

  /**
   * Whether to automatically refresh tokens before they expire
   * @default true
   */
  autoRefreshToken?: boolean;

  /**
   * Whether to persist session in storage
   * @default true
   */
  persistSession?: boolean;

  /**
   * Custom headers to include with every request
   */
  headers?: Record<string, string>;
}

export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface AuthSession {
  user: UserSchema;
  accessToken: string;
  expiresAt?: Date;
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

  constructor(message: string, statusCode: number, error: string, nextActions?: string) {
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
      apiError.nextActions
    );
  }
}