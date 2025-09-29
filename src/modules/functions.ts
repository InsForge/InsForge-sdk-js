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

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Invokes an Edge Function
   * @param slug The function slug to invoke
   * @param options Request options
   */
  async invoke<T = any>(
    slug: string,
    options: FunctionInvokeOptions = {}
  ): Promise<{ data: T | null; error: Error | null }> {
    try {
      const { method = 'POST', body, headers = {} } = options;
      
      // Simple path: /functions/{slug}
      const path = `/functions/${slug}`;
      
      // Use the HTTP client's request method
      const data = await this.http.request<T>(
        method,
        path,
        { body, headers }
      );
      
      return { data, error: null };
    } catch (error: any) {
      // The HTTP client throws InsForgeError with all properties from the response
      // including error, message, details, statusCode, etc.
      // We need to preserve all of that information
      return { 
        data: null, 
        error: error  // Pass through the full error object with all properties
      };
    }
  }
}