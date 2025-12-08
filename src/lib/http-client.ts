import { InsForgeConfig, ApiError, InsForgeError } from '../types';

export interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

/**
 * Callback type for token refresh
 * Returns new access token or null if refresh failed
 */
export type RefreshCallback = () => Promise<string | null>;

export class HttpClient {
  public readonly baseUrl: string;
  public readonly fetch: typeof fetch;
  private defaultHeaders: Record<string, string>;
  private anonKey: string | undefined;
  private userToken: string | null = null;
  
  // Auto-refresh support
  private refreshCallback?: RefreshCallback;
  private isRefreshing = false;
  private refreshQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(config: InsForgeConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:7130';
    // Properly bind fetch to maintain its context
    this.fetch = config.fetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined as any);
    this.anonKey = config.anonKey;
    this.defaultHeaders = {
      ...config.headers,
    };

    if (!this.fetch) {
      throw new Error(
        'Fetch is not available. Please provide a fetch implementation in the config.'
      );
    }
  }

  /**
   * Set the refresh callback for automatic token refresh on 401
   */
  setRefreshCallback(callback: RefreshCallback): void {
    this.refreshCallback = callback;
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
    return this.performRequest<T>(method, path, options, false);
  }

  private async performRequest<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
    isRetry = false
  ): Promise<T> {
    const { params, headers = {}, body, ...fetchOptions } = options;
    
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
    
    const response = await this.fetch(url, {
      method,
      headers: requestHeaders,
      body: processedBody,
      credentials: 'include', // Essential for httpOnly cookies (refresh token)
      ...fetchOptions,
    });

    // Handle 401 with automatic refresh (only if we have a refresh callback and this isn't already a retry)
    if (response.status === 401 && !isRetry && this.refreshCallback) {
      const newToken = await this.handleTokenRefresh();
      if (newToken) {
        this.setAuthToken(newToken);
        return this.performRequest<T>(method, path, options, true);
      }
    }

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

  /**
   * Handle token refresh with queue to prevent duplicate refreshes
   * Multiple concurrent 401s will wait for a single refresh to complete
   */
  private async handleTokenRefresh(): Promise<string | null> {
    // If already refreshing, queue this request
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.refreshQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;

    try {
      const newToken = await this.refreshCallback!();
      
      // Resolve all queued requests with the new token (or null if refresh failed)
      this.refreshQueue.forEach(({ resolve, reject }) => {
        if (newToken) {
          resolve(newToken);
        } else {
          reject(new Error('Token refresh failed'));
        }
      });
      this.refreshQueue = [];
      
      return newToken;
    } catch (error) {
      // Reject all queued requests
      this.refreshQueue.forEach(({ reject }) => {
        reject(error instanceof Error ? error : new Error('Token refresh failed'));
      });
      this.refreshQueue = [];
      
      return null;
    } finally {
      this.isRefreshing = false;
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
}
