# Functions In-Process Dispatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Deno Subhosting from returning `508 Loop Detected` when one bundled function uses the SDK to invoke another, by short-circuiting the SDK to the router's handler in-process.

**Architecture:** Auto-generated `main.ts` exposes the router handler on `globalThis.__insforge_dispatch__`. The SDK's `Functions.invoke` probes for that global; when present, it constructs a `Request` and awaits the handler directly — no network. When absent (browser, external server, old router), it falls through to the existing HTTP path. The decision is per-call and requires no new SDK config flag.

**Tech Stack:** TypeScript, Vitest, Deno (router runtime).

**Spec:** [docs/superpowers/specs/2026-04-15-functions-in-process-dispatch-design.md](../specs/2026-04-15-functions-in-process-dispatch-design.md)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/http-client.ts` | Modify | Extract `serializeBody` and `parseResponse` as exported helpers; refactor `handleRequest` to call them |
| `src/lib/__tests__/http-client.test.ts` | Modify | Add direct unit tests for the two extracted helpers |
| `src/types/globals.d.ts` | Create | Declare type for `globalThis.__insforge_dispatch__` |
| `src/modules/functions.ts` | Modify | Add in-process dispatch branch + `buildInProcessRequest` |
| `src/modules/__tests__/functions.test.ts` | Create | Cover both HTTP path and in-process path for `Functions.invoke` |
| **`generateRouter()` in InsForge backend repo** | **Modify (out of this repo)** | Wrap handler in named `dispatch` const; publish on `globalThis` |

Two helpers (`serializeBody`, `parseResponse`) stay co-located in `http-client.ts` because they encode the SDK's wire-format conventions and the file already owns that domain. Pulling them into separate files would scatter cohesive logic without a clear win.

---

## Task 1: Extract `serializeBody` Helper from `HttpClient.handleRequest`

**Files:**
- Modify: `src/lib/http-client.ts` (current body-serialization block at lines 165-179)
- Test: `src/lib/__tests__/http-client.test.ts`

Pure refactor. New top-level export with identical behavior. Existing HttpClient tests must continue to pass.

- [ ] **Step 1: Write failing tests for `serializeBody`**

Append to `src/lib/__tests__/http-client.test.ts` (after the existing `describe('HttpClient', ...)` block, inside the same file):

```ts
import { HttpClient, serializeBody } from '../http-client';

describe('serializeBody', () => {
  it('returns no body and no content-type when input is undefined', () => {
    const headers: Record<string, string> = {};
    const result = serializeBody('POST', undefined, headers);
    expect(result).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('JSON-stringifies a plain object and sets content-type for non-GET', () => {
    const headers: Record<string, string> = {};
    const result = serializeBody('POST', { a: 1 }, headers);
    expect(result).toBe('{"a":1}');
    expect(headers['Content-Type']).toBe('application/json;charset=UTF-8');
  });

  it('JSON-stringifies but does NOT set content-type for GET', () => {
    const headers: Record<string, string> = {};
    const result = serializeBody('GET', { a: 1 }, headers);
    expect(result).toBe('{"a":1}');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('passes FormData through unchanged and does not set content-type', () => {
    const headers: Record<string, string> = {};
    const fd = new FormData();
    fd.append('k', 'v');
    const result = serializeBody('POST', fd, headers);
    expect(result).toBe(fd);
    expect(headers['Content-Type']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/http-client.test.ts`
Expected: FAIL — `serializeBody` is not exported from `../http-client`.

- [ ] **Step 3: Add the exported `serializeBody` function**

In `src/lib/http-client.ts`, add this top-level function above the `HttpClient` class (after the existing constants near line 24):

```ts
/**
 * Serialize a request body into something fetch (or a Request constructor) accepts.
 * - undefined → no body, no content-type set
 * - FormData → pass-through, content-type left to runtime (multipart boundary)
 * - anything else → JSON.stringify; sets Content-Type to application/json for non-GET
 *
 * Mutates the provided `headers` object to set Content-Type when applicable.
 * Returns the serialized body, or undefined if input was undefined.
 */
export function serializeBody(
  method: string,
  body: unknown,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return body;
  }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json;charset=UTF-8';
  }
  return JSON.stringify(body);
}
```

- [ ] **Step 4: Refactor `handleRequest` to call `serializeBody`**

In `src/lib/http-client.ts`, replace lines 165-179 (the inline `processedBody` block):

```ts
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
```

with:

```ts
    const processedBody = serializeBody(method, body, requestHeaders);
```

- [ ] **Step 5: Run all unit tests to verify nothing regressed**

Run: `npm run test:run`
Expected: PASS — both new `serializeBody` tests and all existing `HttpClient` tests.

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/http-client.ts src/lib/__tests__/http-client.test.ts
git commit -m "refactor(http-client): extract serializeBody helper"
```

---

## Task 2: Extract `parseResponse` Helper from `HttpClient.handleRequest`

**Files:**
- Modify: `src/lib/http-client.ts` (current response-parsing block at lines 275-345)
- Test: `src/lib/__tests__/http-client.test.ts`

Pure refactor. The new helper handles 204, JSON/text parsing, and non-2xx → `InsForgeError` mapping. Logger calls remain inside `handleRequest` (the helper has no logger dependency).

- [ ] **Step 1: Write failing tests for `parseResponse`**

Append to `src/lib/__tests__/http-client.test.ts`:

```ts
import { parseResponse } from '../http-client';

function makeResponse(init: {
  status: number;
  statusText?: string;
  contentType?: string | null;
  bodyText?: string;
  jsonValue?: unknown;
  jsonThrows?: boolean;
}): Response {
  const headers = new Headers();
  if (init.contentType) headers.set('content-type', init.contentType);
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.statusText ?? '',
    headers,
    json: () =>
      init.jsonThrows
        ? Promise.reject(new Error('bad json'))
        : Promise.resolve(init.jsonValue),
    text: () => Promise.resolve(init.bodyText ?? ''),
  } as Response;
}

describe('parseResponse', () => {
  it('returns undefined for 204', async () => {
    const res = makeResponse({ status: 204 });
    expect(await parseResponse(res)).toBeUndefined();
  });

  it('parses JSON body for 2xx with json content-type', async () => {
    const res = makeResponse({
      status: 200,
      contentType: 'application/json',
      jsonValue: { a: 1 },
    });
    expect(await parseResponse(res)).toEqual({ a: 1 });
  });

  it('parses PostgREST vnd.pgrst.object+json content-type as JSON', async () => {
    const res = makeResponse({
      status: 200,
      contentType: 'application/vnd.pgrst.object+json',
      jsonValue: { id: 1 },
    });
    expect(await parseResponse(res)).toEqual({ id: 1 });
  });

  it('returns text body when content-type is not JSON', async () => {
    const res = makeResponse({
      status: 200,
      contentType: 'text/plain',
      bodyText: 'hello',
    });
    expect(await parseResponse(res)).toBe('hello');
  });

  it('throws InsForgeError mapped from { error, message } body on non-2xx', async () => {
    const res = makeResponse({
      status: 400,
      statusText: 'Bad Request',
      contentType: 'application/json',
      jsonValue: { error: 'INVALID_INPUT', message: 'name required' },
    });
    await expect(parseResponse(res)).rejects.toMatchObject({
      statusCode: 400,
      error: 'INVALID_INPUT',
      message: 'name required',
    });
  });

  it('preserves extra fields on InsForgeError from error body', async () => {
    const res = makeResponse({
      status: 400,
      contentType: 'application/json',
      jsonValue: { error: 'X', message: 'm', requestId: 'r-1', detail: 'd' },
    });
    const err = await parseResponse(res).catch((e) => e);
    expect(err).toBeInstanceOf(InsForgeError);
    expect((err as any).requestId).toBe('r-1');
    expect((err as any).detail).toBe('d');
  });

  it('throws generic InsForgeError on non-2xx without error body', async () => {
    const res = makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      contentType: 'application/json',
      jsonValue: {},
    });
    await expect(parseResponse(res)).rejects.toMatchObject({
      statusCode: 503,
      error: 'REQUEST_FAILED',
    });
  });

  it('throws PARSE_ERROR on 2xx with invalid JSON', async () => {
    const res = makeResponse({
      status: 200,
      contentType: 'application/json',
      jsonThrows: true,
    });
    await expect(parseResponse(res)).rejects.toMatchObject({
      statusCode: 200,
      error: 'PARSE_ERROR',
    });
  });

  it('throws REQUEST_FAILED when JSON parse fails on a non-2xx response', async () => {
    const res = makeResponse({
      status: 500,
      contentType: 'application/json',
      jsonThrows: true,
    });
    await expect(parseResponse(res)).rejects.toMatchObject({
      statusCode: 500,
      error: 'REQUEST_FAILED',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/http-client.test.ts`
Expected: FAIL — `parseResponse` not exported.

- [ ] **Step 3: Add the exported `parseResponse` function**

In `src/lib/http-client.ts`, add below `serializeBody`:

```ts
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
      if (!data.statusCode && !data.status) {
        data.statusCode = response.status;
      }
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
```

- [ ] **Step 4: Refactor `handleRequest` to call `parseResponse`**

In `src/lib/http-client.ts`, replace the block from line 275 (`// Handle 204 No Content`) through line 345 (`return data as T;`) with:

```ts
        // Parse body via shared helper; logger fires after either way
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
```

- [ ] **Step 5: Run all unit tests**

Run: `npm run test:run`
Expected: PASS — new `parseResponse` tests + all existing tests (including the existing 204, error-body, and parse-error coverage in `HttpClient`).

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/http-client.ts src/lib/__tests__/http-client.test.ts
git commit -m "refactor(http-client): extract parseResponse helper"
```

---

## Task 3: Add Global Type Declaration

**Files:**
- Create: `src/types/globals.d.ts`

Lets the SDK reference `globalThis.__insforge_dispatch__` without `as any`. `tsconfig.json` already includes `src/**/*`, so no config change is needed.

- [ ] **Step 1: Create the file**

Create `src/types/globals.d.ts`:

```ts
export {};

declare global {
  // Published by the auto-generated Deno router (main.ts) inside an
  // InsForge functions deployment. The SDK probes this to short-circuit
  // function-to-function calls in-process and avoid Deno Subhosting's
  // 508 Loop Detected. Undefined everywhere else (browser, external server).
  // eslint-disable-next-line no-var
  var __insforge_dispatch__:
    | ((req: Request) => Promise<Response>)
    | undefined;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/globals.d.ts
git commit -m "feat(types): declare globalThis.__insforge_dispatch__"
```

---

## Task 4: Add In-Process Dispatch to `Functions.invoke`

**Files:**
- Modify: `src/modules/functions.ts`
- Create: `src/modules/__tests__/functions.test.ts`

Adds the in-process branch and the request-construction helper. Tests both the new path and the existing HTTP path so we don't regress.

- [ ] **Step 1: Create the test file with all cases**

Create `src/modules/__tests__/functions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Functions } from '../functions';
import { HttpClient } from '../../lib/http-client';
import { InsForgeError } from '../../types';
import { TokenManager } from '../../lib/token-manager';

function makeTokenManager(): TokenManager {
  return {
    saveSession: vi.fn(),
    clearSession: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    getAccessToken: vi.fn().mockReturnValue(null),
  } as unknown as TokenManager;
}

function makeHttp(fetchFn: ReturnType<typeof vi.fn>) {
  return new HttpClient(
    {
      baseUrl: 'http://localhost:7130',
      fetch: fetchFn as any,
      retryCount: 0,
      timeout: 0,
    },
    makeTokenManager(),
  );
}

function jsonRes(status: number, body: any, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Functions.invoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).__insforge_dispatch__;
  });

  describe('HTTP path (no global)', () => {
    it('uses subhosting URL when functionsUrl is configured', async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { ok: true }));
      const http = makeHttp(fetchFn);
      const fns = new Functions(http, 'https://app.functions.insforge.app');

      const result = await fns.invoke('hello', { body: { x: 1 } });

      expect(result).toEqual({ data: { ok: true }, error: null });
      expect(fetchFn).toHaveBeenCalledOnce();
      const calledUrl = fetchFn.mock.calls[0][0];
      expect(String(calledUrl)).toBe('https://app.functions.insforge.app/hello');
    });

    it('falls back to proxy when subhosting returns 404', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(404, { error: 'NOT_FOUND', message: 'no' }, 'Not Found'))
        .mockResolvedValueOnce(jsonRes(200, { proxied: true }));
      const http = makeHttp(fetchFn);
      const fns = new Functions(http, 'https://app.functions.insforge.app');

      const result = await fns.invoke('hello');

      expect(result).toEqual({ data: { proxied: true }, error: null });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(String(fetchFn.mock.calls[1][0])).toContain('/functions/hello');
    });
  });

  describe('in-process path (global present)', () => {
    it('calls dispatch and returns parsed JSON without using fetch', async () => {
      const fetchFn = vi.fn();
      const http = makeHttp(fetchFn);
      const fns = new Functions(http, 'https://app.functions.insforge.app');
      const dispatch = vi.fn().mockResolvedValue(jsonRes(200, { ok: 1 }));
      (globalThis as any).__insforge_dispatch__ = dispatch;

      const result = await fns.invoke('hello', { body: { x: 1 } });

      expect(result).toEqual({ data: { ok: 1 }, error: null });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledOnce();
    });

    it('maps non-2xx JSON error to InsForgeError', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      (globalThis as any).__insforge_dispatch__ = vi
        .fn()
        .mockResolvedValue(jsonRes(500, { error: 'BOOM', message: 'kapow' }, 'Server Error'));

      const result = await fns.invoke('hello');

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(InsForgeError);
      expect(result.error?.statusCode).toBe(500);
      expect(result.error?.error).toBe('BOOM');
      expect(result.error?.message).toBe('kapow');
    });

    it('wraps a thrown dispatch error as InsForgeError(500, FUNCTION_ERROR)', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      (globalThis as any).__insforge_dispatch__ = vi
        .fn()
        .mockRejectedValue(new Error('handler crashed'));

      const result = await fns.invoke('hello');

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(InsForgeError);
      expect(result.error?.statusCode).toBe(500);
      expect(result.error?.error).toBe('FUNCTION_ERROR');
      expect(result.error?.message).toBe('handler crashed');
    });

    it('sends body as JSON with application/json content-type', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      const dispatch = vi.fn().mockResolvedValue(jsonRes(200, {}));
      (globalThis as any).__insforge_dispatch__ = dispatch;

      await fns.invoke('hello', { body: { a: 1, b: 'x' } });

      const req = dispatch.mock.calls[0][0] as Request;
      expect(req.headers.get('content-type')).toContain('application/json');
      expect(await req.json()).toEqual({ a: 1, b: 'x' });
    });

    it('forwards caller-provided headers (caller wins on conflict)', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      const dispatch = vi.fn().mockResolvedValue(jsonRes(200, {}));
      (globalThis as any).__insforge_dispatch__ = dispatch;

      await fns.invoke('hello', {
        body: { x: 1 },
        headers: { Authorization: 'Bearer xyz', 'X-Custom': 'v' },
      });

      const req = dispatch.mock.calls[0][0] as Request;
      expect(req.headers.get('authorization')).toBe('Bearer xyz');
      expect(req.headers.get('x-custom')).toBe('v');
    });

    it('passes slug subpath through as request pathname', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      const dispatch = vi.fn().mockResolvedValue(jsonRes(200, {}));
      (globalThis as any).__insforge_dispatch__ = dispatch;

      await fns.invoke('foo/bar');

      const req = dispatch.mock.calls[0][0] as Request;
      expect(new URL(req.url).pathname).toBe('/foo/bar');
    });

    it('uses GET without setting JSON content-type when method is GET', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      const dispatch = vi.fn().mockResolvedValue(jsonRes(200, {}));
      (globalThis as any).__insforge_dispatch__ = dispatch;

      await fns.invoke('hello', { method: 'GET' });

      const req = dispatch.mock.calls[0][0] as Request;
      expect(req.method).toBe('GET');
      expect(req.headers.get('content-type')).toBeNull();
    });

    it('returns { data: undefined, error: null } when dispatch returns 204', async () => {
      const http = makeHttp(vi.fn());
      const fns = new Functions(http);
      (globalThis as any).__insforge_dispatch__ = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 204 }));

      const result = await fns.invoke('hello');

      expect(result).toEqual({ data: undefined, error: null });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/modules/__tests__/functions.test.ts`
Expected: HTTP-path tests PASS (existing behavior); in-process tests FAIL because `Functions.invoke` doesn't yet probe the global.

- [ ] **Step 3: Add in-process dispatch to `Functions.invoke`**

Replace the entire `src/modules/functions.ts` file with:

```ts
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

    // 1. In-process dispatch (same Deno deployment as the router)
    const dispatch = globalThis.__insforge_dispatch__;
    if (typeof dispatch === 'function') {
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
```

- [ ] **Step 4: Run the new test file to verify all cases pass**

Run: `npm run test:run -- src/modules/__tests__/functions.test.ts`
Expected: PASS — all 10 cases (2 HTTP-path + 8 in-process).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm run test:run`
Expected: PASS across the whole suite.

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors. (If lint flags `no-empty-block` on the `// fall through to proxy` branch, leave the explanatory comment in place — that comment was already in the file before this change.)

- [ ] **Step 8: Commit**

```bash
git add src/modules/functions.ts src/modules/__tests__/functions.test.ts
git commit -m "feat(functions): in-process dispatch via globalThis.__insforge_dispatch__"
```

---

## Task 5: Build Verification

**Files:**
- None modified.

End-to-end check that the SDK still bundles cleanly with the new types and exports.

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: dist/ produced without errors.

- [ ] **Step 2: Verify `serializeBody`, `parseResponse`, and `Functions` are present in the build output**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 3: Commit if any incidental changes (none expected)**

If `git status` shows any untracked or modified files at this point, investigate before committing. Otherwise skip.

---

## Task 6: Cross-Repo — Update `generateRouter` in InsForge Backend

**This task is performed in the InsForge backend repository, NOT in this SDK repo.** Locate the `generateRouter(functions)` function (it produces the auto-generated `main.ts` for Deno deployments).

The change is mechanical: extract today's inline `Deno.serve` callback into a named `dispatch` const, publish it on `globalThis`, then pass it to `Deno.serve`. Apply to both the empty-functions branch and the populated branch.

- [ ] **Step 1: Update the empty-functions branch**

Replace the current empty-router string with:

```ts
return `
// Auto-generated router (no functions)
const dispatch = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/health" || pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      type: "insforge-functions",
      functions: [],
      timestamp: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({
    error: "No functions deployed",
  }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
};

(globalThis as any).__insforge_dispatch__ = dispatch;

Deno.serve(dispatch);
`;
```

- [ ] **Step 2: Update the populated-functions branch**

Replace the current populated-router string with:

```ts
return `
// Auto-generated router
${imports}

const routes: Record<string, (req: Request) => Promise<Response>> = {
${routes}
};

const dispatch = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Health check
  if (pathname === "/health" || pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      type: "insforge-functions",
      functions: Object.keys(routes),
      timestamp: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Extract function slug
  const pathParts = pathname.split("/").filter(Boolean);
  const slug = pathParts[0];

  if (!slug || !routes[slug]) {
    return new Response(JSON.stringify({
      error: "Function not found",
      available: Object.keys(routes),
    }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Execute function
  try {
    const handler = routes[slug];

    // If there's a subpath, create modified request
    const subpath = pathParts.slice(1).join("/");
    let funcReq = req;
    if (subpath) {
      const newUrl = new URL(req.url);
      newUrl.pathname = "/" + subpath;
      funcReq = new Request(newUrl.toString(), req);
    }

    const startTime = Date.now();
    const response = await handler(funcReq);
    const duration = Date.now() - startTime;

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      slug,
      method: req.method,
      status: response.status,
      duration: duration + "ms",
    }));

    return response;
  } catch (error) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({
      error: "Function execution failed",
      message: (error as Error).message,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

(globalThis as any).__insforge_dispatch__ = dispatch;

Deno.serve(dispatch);
`;
```

The body inside `dispatch` is identical to today's inline callback — the only structural change is naming it, publishing it, and passing it to `Deno.serve`.

- [ ] **Step 3: Backend test/build per backend repo's conventions**

Run the backend's existing test/typecheck/build for the function-deployment service. No new tests are required for this change — existing router tests should continue to pass since handler logic is unchanged.

- [ ] **Step 4: Deploy a test function pair to verify end-to-end**

Deploy two functions to the same project where function B uses `@insforge/sdk` (with this repo's changes published) to call function A. Confirm:
- B → A succeeds, returns A's response.
- No `508 Loop Detected` in logs.
- External callers (curl from outside the deployment) still hit both A and B normally over HTTPS.

- [ ] **Step 5: Commit the backend change in the backend repo**

Use the backend repo's commit conventions.

---

## Notes for the Implementer

- **Why no retry / timeout on in-process path:** the call never leaves the process, so network failures and network timeouts don't exist. A handler that hangs is a business bug; surfacing it (rather than swallowing it under a 30s default) is the correct behavior.
- **Why no token refresh on in-process path:** the calling function already holds the request's auth context; silently rotating tokens during an internal call would mutate caller-visible state in surprising ways. If a handler returns 401, surface it.
- **Why no fallback from in-process to HTTP on 404:** if the slug isn't in the routes table, no proxy will have it either, and falling back risks re-triggering the loop in misconfigurations.
- **Why a placeholder host (`http://insforge.local`):** Deno requires absolute URLs in `Request`. The router only reads `pathname`. Using a non-routable `.local` host makes the in-process intent obvious to anyone reading a request log.
- **`isServerMode` is intentionally untouched.** It governs CSRF/localStorage in auth — orthogonal to in-process dispatch.
