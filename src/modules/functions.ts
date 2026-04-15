import { HttpClient, parseResponse, serializeBody } from '../lib/http-client';
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
 * Edge Functions client for invoking serverless functions.
 *
 * @example
 * ```typescript
 * const { data, error } = await client.functions.invoke('hello-world', {
 *   body: { name: 'World' }
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
   * Build a Request for in-process dispatch. The host is a non-routable
   * placeholder; the router only reads pathname.
   */
  private buildInProcessRequest(
    slug: string,
    method: string,
    body: unknown,
    callerHeaders: Record<string, string>,
  ): Request {
    const url = new URL('/' + slug, 'http://insforge.local').toString();
    // Start from HttpClient defaults (Authorization, anon key, etc.) so
    // in-process calls carry the same auth context as HTTP calls.
    const headers: Record<string, string> = { ...this.http.getHeaders() };
    const reqBody = serializeBody(method, body, headers);
    Object.assign(headers, callerHeaders); // caller wins
    return new Request(url, {
      method,
      headers,
      body: reqBody,
    });
  }

  /**
   * Invoke an Edge Function.
   *
   * Dispatch order:
   * 1. If `globalThis.__insforge_dispatch__` is present, call it in-process.
   *    This avoids Deno Subhosting's 508 Loop Detected when one bundled
   *    function invokes another inside the same deployment.
   * 2. Otherwise, try the configured subhosting URL.
   * 3. On 404 from subhosting, fall back to the proxy path.
   *
   * @param slug The function slug to invoke
   * @param options Request options
   */
  async invoke<T = any>(
    slug: string,
    options: FunctionInvokeOptions = {},
  ): Promise<{ data: T | null; error: InsForgeError | null }> {
    const { method = 'POST', body, headers = {} } = options;

    // 1. In-process dispatch (same Deno deployment as the router).
    // Only short-circuit when the target is the local derived subhosting URL —
    // otherwise we'd misroute cross-deployment calls to the local router.
    const dispatch = globalThis.__insforge_dispatch__;
    const localFunctionsUrl = Functions.deriveSubhostingUrl(this.http.baseUrl);
    if (
      typeof dispatch === 'function' &&
      !!localFunctionsUrl &&
      this.functionsUrl === localFunctionsUrl
    ) {
      try {
        const req = this.buildInProcessRequest(slug, method, body, headers);
        const res = await dispatch(req);
        const data = await parseResponse<T>(res);
        return { data, error: null };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        return {
          data: null,
          error:
            error instanceof InsForgeError
              ? error
              : new InsForgeError(
                  error instanceof Error ? error.message : 'Function invocation failed',
                  500,
                  'FUNCTION_ERROR',
                ),
        };
      }
    }

    // 2. Direct subhosting URL
    if (this.functionsUrl) {
      try {
        const data = await this.http.request<T>(method, `${this.functionsUrl}/${slug}`, {
          body,
          headers,
        });
        return { data, error: null };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        if (error instanceof InsForgeError && error.statusCode === 404) {
          // fall through to proxy
        } else {
          return {
            data: null,
            error:
              error instanceof InsForgeError
                ? error
                : new InsForgeError(
                    error instanceof Error ? error.message : 'Function invocation failed',
                    500,
                    'FUNCTION_ERROR',
                  ),
          };
        }
      }
    }

    // 3. Proxy fallback
    try {
      const path = `/functions/${slug}`;
      const data = await this.http.request<T>(method, path, { body, headers });
      return { data, error: null };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return {
        data: null,
        error:
          error instanceof InsForgeError
            ? error
            : new InsForgeError(
                error instanceof Error ? error.message : 'Function invocation failed',
                500,
                'FUNCTION_ERROR',
              ),
      };
    }
  }
}
