import { HttpClient } from '../lib/http-client';

export interface FunctionInvokeOptions {
  /**
   * The body of the request
   */
  body?: any;

  /**
   * Custom headers to send with the request
   */
  headers?: Record<string, string>;

  /**
   * HTTP method (default: POST)
   */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

/**
 * Edge Functions client for invoking serverless functions
 *
 * @example
 * ```typescript
 * // Invoke a function with JSON body
 * const { data, error } = await client.functions.invoke('hello-world', {
 *   body: { name: 'World' }
 * });
 *
 * // GET request
 * const { data, error } = await client.functions.invoke('get-data', {
 *   method: 'GET'
 * });
 * ```
 */
export class Functions {
  private http: HttpClient;
  private functionsUrl: string | undefined;

  constructor(http: HttpClient, functionsUrl?: string) {
    this.http = http;
    this.functionsUrl = functionsUrl || Functions.deriveSubhostingUrl(http.baseUrl);
  }

  /**
   * Derive the subhosting URL from the base URL.
   * Base URL pattern: https://{appKey}.{region}.insforge.app
   * Functions URL:    https://{appKey}.functions.insforge.app
   * Only applies to .insforge.app domains.
   */
  private static deriveSubhostingUrl(baseUrl: string): string | undefined {
    try {
      const { hostname } = new URL(baseUrl);
      if (!hostname.endsWith('.insforge.app')) return undefined;
      const appKey = hostname.split('.')[0];
      return `https://${appKey}.functions.insforge.app`;
    } catch {
      return undefined;
    }
  }

  /**
   * Invokes an Edge Function
   *
   * If functionsUrl is configured, tries direct subhosting first.
   * Falls back to proxy URL if subhosting returns 404.
   *
   * @param slug The function slug to invoke
   * @param options Request options
   */
  async invoke<T = any>(
    slug: string,
    options: FunctionInvokeOptions = {}
  ): Promise<{ data: T | null; error: Error | null }> {
    const { method = 'POST', body, headers = {} } = options;

    // Try direct subhosting URL first if configured
    if (this.functionsUrl) {
      try {
        const data = await this.invokeDirectly<T>(slug, method, body, headers);
        return { data, error: null };
      } catch (error: any) {
        // If 404, fall through to proxy
        if (error?.statusCode === 404) {
          // Function not found on subhosting, try proxy
        } else {
          // Other errors, return immediately
          return { data: null, error };
        }
      }
    }

    // Fall back to proxy URL
    try {
      const path = `/functions/${slug}`;
      const data = await this.http.request<T>(method, path, { body, headers });
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }

  /**
   * Invoke function directly on subhosting URL
   */
  private async invokeDirectly<T>(
    slug: string,
    method: string,
    body: any,
    headers: Record<string, string>
  ): Promise<T> {
    const url = `${this.functionsUrl}/${slug}`;

    const requestHeaders: Record<string, string> = {
      ...this.http.getHeaders(),
      ...headers,
    };

    if (body !== undefined && method !== 'GET') {
      requestHeaders['Content-Type'] = 'application/json;charset=UTF-8';
    }

    const response = await this.http.fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type');
    let data: any;
    if (contentType?.includes('json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const error: any = new Error(data?.message || response.statusText);
      error.statusCode = response.status;
      if (data && typeof data === 'object') {
        Object.assign(error, data);
      }
      throw error;
    }

    return data as T;
  }
}