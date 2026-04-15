import {
  InsForgeConfig,
  ApiError,
  InsForgeError,
  AuthRefreshResponse,
} from '../types';
import { Logger } from './logger';
import {
  clearCsrfToken,
  getCsrfToken,
  setCsrfToken,
  TokenManager,
} from './token-manager';

type JsonRequestBody = Record<string, unknown> | unknown[] | null;
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string>;
  body?: RequestInit['body'] | JsonRequestBody;
  /** Allow retrying non-idempotent requests (POST, PATCH). Off by default to prevent duplicate writes. */
  idempotent?: boolean;
}

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

/**
 * Serialize a request body into something fetch (or a Request constructor) accepts.
 * - undefined → no body, no content-type set
 * - GET/HEAD → no body returned regardless of input (WHATWG Fetch forbids bodies on GET/HEAD)
 * - FormData → pass-through, content-type left to runtime (multipart boundary)
 * - anything else → JSON.stringify; unconditionally sets Content-Type to application/json
 *
 * Mutates the provided `headers` object to set Content-Type when applicable.
 * Returns the serialized body, or undefined if input was undefined or method is GET/HEAD.
 */
export function serializeBody(
  method: string,
  body: unknown,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return body;
  }
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return JSON.stringify(body);
}

/**
 * Parse a fetch Response into typed data, mapping non-2xx to InsForgeError.
 * - 204 → undefined
 * - JSON content-type → parsed JSON
 * - other content-type → text
 * - body parse failure → InsForgeError(PARSE_ERROR | REQUEST_FAILED)
 * - non-2xx with `{ error, message }` body → InsForgeError.fromApiError, all extra fields preserved
 * - non-2xx without that shape → InsForgeError(REQUEST_FAILED)
 */
export async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  let data: any;
  const contentType = response.headers.get('content-type');
  try {
    if (contentType?.includes('json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
  } catch (parseErr: any) {
    throw new InsForgeError(
      `Failed to parse response body: ${parseErr?.message || 'Unknown error'}`,
      response.status,
      response.ok ? 'PARSE_ERROR' : 'REQUEST_FAILED',
    );
  }

  if (!response.ok) {
    if (data && typeof data === 'object' && 'error' in data) {
      data.statusCode ??= data.status ?? response.status;
      const error = InsForgeError.fromApiError(data as ApiError);
      Object.keys(data).forEach((key) => {
        if (key !== 'error' && key !== 'message' && key !== 'statusCode') {
          (error as any)[key] = data[key];
        }
      });
      throw error;
    }
    throw new InsForgeError(
      `Request failed: ${response.statusText}`,
      response.status,
      'REQUEST_FAILED',
    );
  }

  return data as T;
}

/**
 * HTTP client with built-in retry, timeout, and exponential backoff support.
 * Handles authentication, request serialization, and error normalization.
 */
export class HttpClient {
  public readonly baseUrl: string;
  public readonly fetch: typeof fetch;
  private defaultHeaders: Record<string, string>;
  private anonKey: string | undefined;
  private userToken: string | null = null;
  private logger: Logger;
  private autoRefreshToken: boolean = true;
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<AuthRefreshResponse> | null = null;
  private tokenManager: TokenManager;
  private refreshToken: string | null = null;
  private timeout: number;
  private retryCount: number;
  private retryDelay: number;

  /**
   * Creates a new HttpClient instance.
   * @param config - SDK configuration including baseUrl, timeout, retry settings, and fetch implementation.
   * @param tokenManager - Token manager for session persistence.
   * @param logger - Optional logger instance for request/response debugging.
   */
  constructor(
    config: InsForgeConfig,
    tokenManager?: TokenManager,
    logger?: Logger,
  ) {
    this.baseUrl = config.baseUrl || 'http://localhost:7130';
    this.autoRefreshToken = config.autoRefreshToken ?? true;
    // Properly bind fetch to maintain its context
    this.fetch =
      config.fetch ||
      (globalThis.fetch
        ? globalThis.fetch.bind(globalThis)
        : (undefined as any));
    this.anonKey = config.anonKey;
    this.defaultHeaders = {
      ...config.headers,
    };
    this.tokenManager = tokenManager ?? new TokenManager();
    this.logger = logger || new Logger(false);
    this.timeout = config.timeout ?? 30_000;
    this.retryCount = config.retryCount ?? 3;
    this.retryDelay = config.retryDelay ?? 500;

    if (!this.fetch) {
      throw new Error(
        'Fetch is not available. Please provide a fetch implementation in the config.',
      );
    }
  }

  /**
   * Builds a full URL from a path and optional query parameters.
   * Normalizes PostgREST select parameters for proper syntax.
   */
  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        // For select parameter, preserve the exact formatting by normalizing whitespace
        // This ensures PostgREST relationship queries work correctly
        if (key === 'select') {
          let normalizedValue = value.replace(/\s+/g, ' ').trim();
          normalizedValue = normalizedValue
            .replace(/\s*\(\s*/g, '(') // Remove spaces around opening parens
            .replace(/\s*\)\s*/g, ')') // Remove spaces around closing parens
            .replace(/\(\s+/g, '(') // Remove spaces after opening parens
            .replace(/\s+\)/g, ')') // Remove spaces before closing parens
            .replace(/,\s+(?=[^()]*\))/g, ','); // Remove spaces after commas inside parens
          url.searchParams.append(key, normalizedValue);
        } else {
          url.searchParams.append(key, value);
        }
      });
    }
    return url.toString();
  }

  /** Checks if an HTTP status code is eligible for retry (5xx server errors). */
  private isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  /**
   * Computes the delay before the next retry using exponential backoff with jitter.
   * @param attempt - The current retry attempt number (1-based).
   * @returns Delay in milliseconds.
   */
  private computeRetryDelay(attempt: number): number {
    const base = this.retryDelay * Math.pow(2, attempt - 1);
    const jitter = base * (0.85 + Math.random() * 0.3);
    return Math.round(jitter);
  }

  /**
   * Performs an HTTP request with automatic retry and timeout handling.
   * Retries on network errors and 5xx server errors with exponential backoff.
   * Client errors (4xx) and timeouts are thrown immediately without retry.
   * @param method - HTTP method (GET, POST, PUT, PATCH, DELETE).
   * @param path - API path relative to the base URL.
   * @param options - Optional request configuration including headers, body, and query params.
   * @returns Parsed response data.
   * @throws {InsForgeError} On timeout, network failure, or HTTP error responses.
   */
  private async handleRequest<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      params,
      headers = {},
      body,
      signal: callerSignal,
      ...fetchOptions
    } = options as RequestOptions & { signal?: AbortSignal };

    const url = this.buildUrl(path, params);
    const startTime = Date.now();
    const canRetry =
      IDEMPOTENT_METHODS.has(method.toUpperCase()) ||
      options.idempotent === true;
    const maxAttempts = canRetry ? this.retryCount : 0;

    const requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
    };

    // Set Authorization header: prefer user token, fallback to anon key
    const authToken = this.userToken || this.anonKey;
    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const processedBody = serializeBody(method, body, requestHeaders);

    // Normalize HeadersInit (Headers | [string,string][] | Record) to plain object
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        requestHeaders[key] = value;
      });
    } else {
      Object.assign(requestHeaders, headers);
    }

    this.logger.logRequest(method, url, requestHeaders, processedBody);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.computeRetryDelay(attempt);
        this.logger.warn(
          `Retry ${attempt}/${maxAttempts} for ${method} ${url} in ${delay}ms`,
        );
        // Abortable backoff sleep — respects caller cancellation
        if (callerSignal?.aborted) throw callerSignal.reason;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(callerSignal!.reason);
          };
          const timer = setTimeout(() => {
            if (callerSignal)
              callerSignal.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          if (callerSignal) {
            callerSignal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }

      let controller: AbortController | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      // Compose SDK timeout signal with caller-provided signal
      if (this.timeout > 0 || callerSignal) {
        controller = new AbortController();

        if (this.timeout > 0) {
          timer = setTimeout(() => controller!.abort(), this.timeout);
        }

        if (callerSignal) {
          if (callerSignal.aborted) {
            controller.abort(callerSignal.reason);
          } else {
            const onCallerAbort = () => controller!.abort(callerSignal!.reason);
            callerSignal.addEventListener('abort', onCallerAbort, {
              once: true,
            });
            // Clean up listener after fetch completes to prevent accumulation
            controller.signal.addEventListener(
              'abort',
              () => {
                callerSignal!.removeEventListener('abort', onCallerAbort);
              },
              { once: true },
            );
          }
        }
      }

      try {
        const response = await this.fetch(url, {
          method,
          headers: requestHeaders,
          body: processedBody,
          ...fetchOptions,
          ...(controller ? { signal: controller.signal } : {}),
        });

        // If server error and retries remaining, continue loop
        if (this.isRetryableStatus(response.status) && attempt < maxAttempts) {
          if (timer !== undefined) clearTimeout(timer);
          // Drain the body to free the connection before retrying
          await response.body?.cancel();
          lastError = new InsForgeError(
            `Server error: ${response.status} ${response.statusText}`,
            response.status,
            'SERVER_ERROR',
          );
          continue;
        }

        // Parse body via shared helper; logger fires after either way.
        // Note: error-path logger now receives the InsForgeError instance
        // (not the raw body) and uses err.statusCode as primary source.
        // Parse failures are now logged here too (previously not logged).
        let data: T;
        try {
          data = await parseResponse<T>(response);
        } catch (err) {
          if (timer !== undefined) clearTimeout(timer);
          if (err instanceof InsForgeError) {
            this.logger.logResponse(
              method,
              url,
              err.statusCode || response.status,
              Date.now() - startTime,
              err,
            );
          }
          throw err;
        }

        if (timer !== undefined) clearTimeout(timer);
        this.logger.logResponse(
          method,
          url,
          response.status,
          Date.now() - startTime,
          data,
        );
        return data;
      } catch (err: any) {
        if (timer !== undefined) clearTimeout(timer);

        // Determine if this was an SDK timeout or a caller abort
        if (err?.name === 'AbortError') {
          if (
            controller &&
            controller.signal.aborted &&
            this.timeout > 0 &&
            !callerSignal?.aborted
          ) {
            throw new InsForgeError(
              `Request timed out after ${this.timeout}ms`,
              408,
              'REQUEST_TIMEOUT',
            );
          }
          // Caller-initiated abort — propagate as-is
          throw err;
        }

        // InsForgeError from response handling — don't retry client errors
        if (err instanceof InsForgeError) {
          throw err;
        }

        // Network error — retry if attempts remain
        if (attempt < maxAttempts) {
          lastError = err;
          continue;
        }

        throw new InsForgeError(
          `Network request failed: ${err?.message || 'Unknown error'}`,
          0,
          'NETWORK_ERROR',
        );
      }
    }

    // Should not normally reach here, but safety net after exhausting retries
    throw (
      lastError ||
      new InsForgeError(
        'Request failed after all retry attempts',
        0,
        'NETWORK_ERROR',
      )
    );
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    try {
      return await this.handleRequest<T>(method, path, { ...options });
    } catch (error) {
      if (
        error instanceof InsForgeError &&
        error.statusCode === 401 &&
        error.error === 'INVALID_TOKEN' &&
        this.autoRefreshToken
      ) {
        try {
          const newTokenData = await this.handleTokenRefresh();
          this.setAuthToken(newTokenData.accessToken);
          this.tokenManager!.saveSession(newTokenData);
          if (newTokenData.csrfToken) {
            setCsrfToken(newTokenData.csrfToken);
          }
          if (newTokenData.refreshToken) {
            this.setRefreshToken(newTokenData.refreshToken);
          }
          return await this.handleRequest<T>(method, path, { ...options });
        } catch (error) {
          this.tokenManager.clearSession();
          this.userToken = null;
          this.refreshToken = null;
          clearCsrfToken();
          throw error;
        }
      }
      throw error;
    }
  }

  /** Performs a GET request. */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  /** Performs a POST request with an optional JSON body. */
  post<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  /** Performs a PUT request with an optional JSON body. */
  put<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  /** Performs a PATCH request with an optional JSON body. */
  patch<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  /** Performs a DELETE request. */
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  /** Sets or clears the user authentication token for subsequent requests. */
  setAuthToken(token: string | null) {
    this.userToken = token;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  /** Returns the current default headers including the authorization header if set. */
  getHeaders(): Record<string, string> {
    const headers = { ...this.defaultHeaders };

    // Include Authorization header if token is available (same logic as request method)
    const authToken = this.userToken || this.anonKey;
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    return headers;
  }

  async handleTokenRefresh(): Promise<AuthRefreshResponse> {
    if (this.isRefreshing) {
      return this.refreshPromise!;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const csrfToken = getCsrfToken();
        const body = this.refreshToken
          ? { refreshToken: this.refreshToken }
          : undefined;
        const response = await this.handleRequest<AuthRefreshResponse>(
          'POST',
          '/api/auth/sessions/current',
          {
            body,
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
            credentials: 'include',
          },
        );
        return response;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}
