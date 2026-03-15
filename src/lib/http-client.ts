import { InsForgeConfig, ApiError, InsForgeError, RetryConfig } from '../types';

export interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  timeoutMs?: number;
  retry?: false | RetryConfig;
}

interface ResolvedRetryConfig {
  retries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
  retryMethods: Set<string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_CONFIG: ResolvedRetryConfig = {
  retries: 2,
  initialDelayMs: 300,
  maxDelayMs: 3_000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryMethods: new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']),
};

export class HttpClient {
  public readonly baseUrl: string;
  public readonly fetch: typeof fetch;
  private defaultHeaders: Record<string, string>;
  private anonKey: string | undefined;
  private userToken: string | null = null;
  private readonly requestTimeoutMs: number;
  private readonly retryConfig: ResolvedRetryConfig;

  constructor(config: InsForgeConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:7130';
    // Properly bind fetch to maintain its context
    this.fetch = config.fetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined as any);
    this.anonKey = config.anonKey;
    this.defaultHeaders = {
      ...config.headers,
    };
    this.requestTimeoutMs = Math.max(1, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.retryConfig = this.resolveRetryConfig(config.retry, DEFAULT_RETRY_CONFIG);

    if (!this.fetch) {
      throw new Error(
        'Fetch is not available. Please provide a fetch implementation in the config.'
      );
    }
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        // For select parameter, preserve the exact formatting by normalizing whitespace
        // This ensures PostgREST relationship queries work correctly
        if (key === 'select') {
          // Normalize multiline select strings for PostgREST:
          // 1. Replace all whitespace (including newlines) with single space
          // 2. Remove spaces inside parentheses for proper PostgREST syntax
          // 3. Keep spaces after commas at the top level for readability
          let normalizedValue = value.replace(/\s+/g, ' ').trim();

          // Fix spaces around parentheses and inside them
          normalizedValue = normalizedValue
            .replace(/\s*\(\s*/g, '(')  // Remove spaces around opening parens
            .replace(/\s*\)\s*/g, ')')  // Remove spaces around closing parens
            .replace(/\(\s+/g, '(')     // Remove spaces after opening parens
            .replace(/\s+\)/g, ')')     // Remove spaces before closing parens
            .replace(/,\s+(?=[^()]*\))/g, ','); // Remove spaces after commas inside parens
          
          url.searchParams.append(key, normalizedValue);
        } else {
          url.searchParams.append(key, value);
        }
      });
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { params, headers = {}, body, timeoutMs, retry, ...fetchOptions } = options;
    const resolvedTimeoutMs = Math.max(1, timeoutMs ?? this.requestTimeoutMs);
    const resolvedRetryConfig =
      retry === false ? null : this.resolveRetryConfig(retry, this.retryConfig);
    const normalizedMethod = method.toUpperCase();

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
    };

    // Set Authorization header: prefer user token, fallback to anon key
    const authToken = this.userToken || this.anonKey;
    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    // Handle body serialization
    let processedBody: any;
    if (body !== undefined) {
      // Check if body is FormData (for file uploads)
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        // Don't set Content-Type for FormData, let browser set it with boundary
        processedBody = body;
      } else {
        // JSON body
        if (method !== 'GET') {
          requestHeaders['Content-Type'] = 'application/json;charset=UTF-8';
        }
        processedBody = JSON.stringify(body);
      }
    }

    Object.assign(requestHeaders, headers);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const { signal, cleanup, didTimeout } = this.createRequestSignal(
        fetchOptions.signal,
        controller,
        resolvedTimeoutMs
      );

      try {
        const response = await this.fetch(url, {
          method: normalizedMethod,
          headers: requestHeaders,
          body: processedBody,
          ...fetchOptions,
          signal,
        });
        cleanup();

        if (
          resolvedRetryConfig &&
          this.shouldRetryResponse(response.status, normalizedMethod, attempt, resolvedRetryConfig)
        ) {
          await this.waitWithBackoff(attempt, resolvedRetryConfig, fetchOptions.signal);
          continue;
        }

        return this.handleResponse<T>(response);
      } catch (error) {
        cleanup();

        if (fetchOptions.signal?.aborted) {
          throw error;
        }

        if (didTimeout()) {
          if (
            resolvedRetryConfig &&
            this.shouldRetryMethod(normalizedMethod, attempt, resolvedRetryConfig)
          ) {
            await this.waitWithBackoff(attempt, resolvedRetryConfig, fetchOptions.signal);
            continue;
          }

          throw new InsForgeError(
            `Request timeout after ${resolvedTimeoutMs}ms`,
            408,
            'REQUEST_TIMEOUT'
          );
        }

        if (
          resolvedRetryConfig &&
          this.shouldRetryError(error, normalizedMethod, attempt, resolvedRetryConfig)
        ) {
          await this.waitWithBackoff(attempt, resolvedRetryConfig, fetchOptions.signal);
          continue;
        }

        throw error;
      }
    }
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  setAuthToken(token: string | null) {
    this.userToken = token;
  }

  getHeaders(): Record<string, string> {
    const headers = { ...this.defaultHeaders };
    
    // Include Authorization header if token is available (same logic as request method)
    const authToken = this.userToken || this.anonKey;
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    return headers;
  }

  private resolveRetryConfig(
    config: RetryConfig | undefined,
    baseConfig: ResolvedRetryConfig
  ): ResolvedRetryConfig {
    return {
      retries: Math.max(0, config?.retries ?? baseConfig.retries),
      initialDelayMs: Math.max(
        0,
        config?.initialDelayMs ?? baseConfig.initialDelayMs
      ),
      maxDelayMs: Math.max(
        0,
        config?.maxDelayMs ?? baseConfig.maxDelayMs
      ),
      backoffMultiplier: Math.max(
        1,
        config?.backoffMultiplier ?? baseConfig.backoffMultiplier
      ),
      retryableStatusCodes: config?.retryableStatusCodes ?? baseConfig.retryableStatusCodes,
      retryMethods: new Set(
        (config?.retryMethods ?? [...baseConfig.retryMethods]).map((value) => value.toUpperCase())
      ),
    };
  }

  private createRequestSignal(
    externalSignal: AbortSignal | null | undefined,
    controller: AbortController,
    timeoutMs: number
  ): {
    signal: AbortSignal;
    cleanup: () => void;
    didTimeout: () => boolean;
  } {
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onAbort);
        }
      },
      didTimeout: () => timedOut,
    };
  }

  private shouldRetryMethod(
    method: string,
    attempt: number,
    config: ResolvedRetryConfig
  ): boolean {
    return attempt < config.retries && config.retryMethods.has(method);
  }

  private shouldRetryResponse(
    status: number,
    method: string,
    attempt: number,
    config: ResolvedRetryConfig
  ): boolean {
    return (
      this.shouldRetryMethod(method, attempt, config) &&
      config.retryableStatusCodes.includes(status)
    );
  }

  private shouldRetryError(
    error: unknown,
    method: string,
    attempt: number,
    config: ResolvedRetryConfig
  ): boolean {
    if (!this.shouldRetryMethod(method, attempt, config)) {
      return false;
    }

    // Retry transient fetch failures (network disconnects, DNS, connection resets, etc)
    if (error instanceof TypeError) {
      return true;
    }

    return false;
  }

  private async waitWithBackoff(
    attempt: number,
    config: ResolvedRetryConfig,
    signal?: AbortSignal | null
  ): Promise<void> {
    const calculatedDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    const delay = Math.min(config.maxDelayMs, calculatedDelay);

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(this.createAbortError(signal));
        return;
      }

      const timeoutId = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delay);

      const onAbort = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        reject(this.createAbortError(signal));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private createAbortError(signal?: AbortSignal | null): unknown {
    if (signal?.reason !== undefined) {
      return signal.reason;
    }

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    return abortError;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    // Try to parse JSON response
    let data: any;
    const contentType = response.headers.get('content-type');
    // Check for any JSON content type (including PostgREST's vnd.pgrst.object+json)
    if (contentType?.includes('json')) {
      data = await response.json();
    } else {
      // For non-JSON responses, return text
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      if (data && typeof data === 'object' && 'error' in data) {
        // Add the HTTP status code if not already in the data
        if (!data.statusCode && !data.status) {
          data.statusCode = response.status;
        }
        const error = InsForgeError.fromApiError(data as ApiError);
        // Preserve all additional fields from the error response
        Object.keys(data).forEach(key => {
          if (key !== 'error' && key !== 'message' && key !== 'statusCode') {
            (error as any)[key] = data[key];
          }
        });
        throw error;
      }
      throw new InsForgeError(
        `Request failed: ${response.statusText}`,
        response.status,
        'REQUEST_FAILED'
      );
    }

    return data as T;
  }
}