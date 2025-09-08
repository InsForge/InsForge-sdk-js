import { InsForgeConfig, ApiError, InsForgeError } from '../types';

export interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

export class HttpClient {
  public readonly baseUrl: string;
  public readonly fetch: typeof fetch;
  private defaultHeaders: Record<string, string>;

  constructor(config: InsForgeConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:7130';
    // Properly bind fetch to maintain its context
    this.fetch = config.fetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined as any);
    this.defaultHeaders = {
      ...config.headers,
    };

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
    const { params, headers = {}, body, ...fetchOptions } = options;
    
    const url = this.buildUrl(path, params);
    
    const requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
    };
    
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
      ...fetchOptions,
    });

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
        throw InsForgeError.fromApiError(data as ApiError);
      }
      throw new InsForgeError(
        `Request failed: ${response.statusText}`,
        response.status,
        'REQUEST_FAILED'
      );
    }

    return data as T;
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
    if (token) {
      this.defaultHeaders['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.defaultHeaders['Authorization'];
    }
  }

  getHeaders(): Record<string, string> {
    return { ...this.defaultHeaders };
  }
}