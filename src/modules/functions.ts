import { HttpClient } from '../lib/http-client';
import { InsForgeError } from '../types';

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
  ): Promise<{ data: T | null; error: InsForgeError | null }> {
    const { method = 'POST', body, headers = {} } = options;

    // Try direct subhosting URL first if configured
    if (this.functionsUrl) {
      try {
        const data = await this.http.request<T>(method, `${this.functionsUrl}/${slug}`, {
          body,
          headers,
        });
        return { data, error: null };
      } catch (error) {
        const normalizedError = error instanceof InsForgeError ? error : new InsForgeError(
          error instanceof Error ? error.message : String(error),
          500,
          'FUNCTION_ERROR'
        );
        // If 404, fall through to proxy
        if (normalizedError.statusCode === 404) {
          // Function not found on subhosting, try proxy
        } else {
          // Other errors, return immediately
          return { data: null, error: normalizedError };
        }
      }
    }

    // Fall back to proxy URL
    try {
      const path = `/functions/${slug}`;
      const data = await this.http.request<T>(method, path, { body, headers });
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          error instanceof Error ? error.message : String(error),
          500,
          'FUNCTION_ERROR'
        ),
      };
    }
  }
}
