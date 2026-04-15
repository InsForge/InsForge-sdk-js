# Functions In-Process Dispatch — Design

## Problem

InsForge functions run on Deno Subhosting under a single-project, multi-function model: every function in a project is bundled into one Deno deployment, and an auto-generated `main.ts` does path-based routing (`/{slug}`). The deployment is reachable at `https://{appKey}.functions.insforge.app`.

When function B (running inside that deployment) uses the SDK to invoke function A, the SDK currently calls `https://{appKey}.functions.insforge.app/A`. Deno Subhosting detects this as a recursive request to the same deployment and returns:

```
508 Loop Detected — Recursive requests to the same deployment cannot be processed.
```

This makes function-to-function composition impossible from inside a function.

## Solution

When the SDK is running **inside the same bundled deployment** as the target function, dispatch in-process — call the router's handler directly with a constructed `Request`, skipping the network entirely. When the SDK is running anywhere else (browser, external server, a different deployment), behavior is unchanged: HTTP to the public functions URL.

The trigger is the presence of `globalThis.__insforge_dispatch__`, which the auto-generated router publishes at module load. No new SDK config flag is required; existing `isServerMode` keeps its current CSRF/localStorage semantics and is not involved.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Deno deployment ({appKey}.functions.insforge.app)       │
│                                                         │
│   main.ts (auto-generated)                              │
│     const dispatch = async (req) => { ...router... }    │
│     globalThis.__insforge_dispatch__ = dispatch         │
│     Deno.serve(dispatch)                                │
│                                                         │
│   ┌──────────────┐                  ┌──────────────┐    │
│   │ function A   │                  │ function B   │    │
│   │  handler     │                  │  handler     │    │
│   └──────────────┘                  └──────┬───────┘    │
│         ▲                                  │            │
│         │                                  ▼            │
│         │                       sdk.functions.invoke(A) │
│         │                                  │            │
│         │                                  ▼            │
│         │                 ┌───────────────────────────┐ │
│         └─── dispatch ◄───┤ globalThis.__insforge_... │ │
│                           └───────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

External caller (browser / other server):
  fetch → https://{appKey}.functions.insforge.app/A → Deno.serve(dispatch) → A
```

Function B's invocation never leaves the process. The router's full logic still runs (health check, slug lookup, subpath rewrite, request log, error wrapping), so the call is semantically equivalent to an HTTP hit.

## Component 1: Router Generator (Backend)

**Location:** the `generateRouter(functions)` function in the InsForge backend (separate repo from this SDK; the function body is reproduced in the original brainstorming context).

**Change:** extract the existing inline `Deno.serve` callback into a named `dispatch` const, publish it on `globalThis`, then pass it to `Deno.serve`. Apply to both empty and non-empty router branches so behavior is consistent regardless of how many functions a deployment has.

Non-empty branch (skeleton):

```ts
// Auto-generated router
${imports}

const routes: Record<string, (req: Request) => Promise<Response>> = {
${routes}
};

const dispatch = async (req: Request): Promise<Response> => {
  // ...identical to today's Deno.serve callback body:
  // health check, slug parse, subpath rewrite, handler call,
  // duration log, error wrapping
};

(globalThis as any).__insforge_dispatch__ = dispatch;

Deno.serve(dispatch);
```

Empty branch: same shape, with the existing "no functions" 404 logic inside `dispatch`.

**Logic inside `dispatch` is unchanged.** Only the wrapping shape moves.

## Component 2: SDK — In-Process Dispatch (`src/modules/functions.ts`)

At the top of `Functions.invoke`, probe for the global. If present, dispatch in-process; otherwise, fall through to the existing subhosting → proxy fallback chain.

```ts
async invoke<T>(slug: string, options: FunctionInvokeOptions = {}) {
  const { method = 'POST', body, headers = {} } = options;

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
        error: error instanceof InsForgeError
          ? error
          : new InsForgeError(
              error instanceof Error ? error.message : 'Function invocation failed',
              500,
              'FUNCTION_ERROR',
            ),
      };
    }
  }

  // existing subhosting → proxy fallback unchanged
  ...
}
```

### Request construction

`buildInProcessRequest(slug, method, body, headers)` produces a `Request`:

- **URL:** `new URL('/' + slug, 'http://insforge.local').toString()`. The router only reads `pathname`; the placeholder host/scheme are intentionally non-routable to make the in-process intent explicit. Slugs containing `/` (e.g. `'foo/bar'`) become pathname `/foo/bar` and exercise the router's existing subpath rewrite.
- **Headers:** start with `this.http.getHeaders()` so `Authorization` (user token or anon key) and any default headers match the HTTP path; merge caller-provided `headers` on top (caller wins on conflict).
- **Body:** mirror `HttpClient.handleRequest` serialization:
  - `undefined` → no body.
  - `FormData` instance → pass through unchanged; do not set `Content-Type`.
  - Anything else (object, array, string, etc.) → `JSON.stringify(body)` and set `Content-Type: application/json;charset=UTF-8` (skipped only for `GET`).

To avoid duplicating serialization logic, factor a shared `serializeBody(method, body, headers)` helper used by both `HttpClient.handleRequest` and `buildInProcessRequest`. It returns `{ body, contentType }` or similar.

### Response parsing

Extract the response-parsing block of `HttpClient.handleRequest` (currently `src/lib/http-client.ts:276–337`) into a free function `parseResponse<T>(response: Response): Promise<T>`. The helper handles:

- `204` → `undefined`
- JSON `Content-Type` → `await response.json()`
- Other → `await response.text()`
- Non-2xx → throw `InsForgeError`, preferring `InsForgeError.fromApiError(data)` when the body has the `{ error, ... }` shape, otherwise a generic `InsForgeError(statusText, status, 'REQUEST_FAILED')`.
- Body parse failures → `InsForgeError('Failed to parse response body…', status, response.ok ? 'PARSE_ERROR' : 'REQUEST_FAILED')`.

`HttpClient.handleRequest` is refactored to call `parseResponse` instead of doing it inline. Behavior is unchanged; this is a pure extraction so both call sites share one implementation.

### What is intentionally NOT applied to in-process dispatch

- **Retry / exponential backoff.** Network failures don't exist in-process; retrying a function handler would silently double-execute side effects.
- **SDK timeout.** No fetch involved; if a handler hangs, that's a business bug and should surface, not be swallowed by SDK's 30s default.
- **Subhosting → proxy fallback.** If `routes[slug]` doesn't exist, the router returns 404 and the SDK surfaces it. There's no proxy that would have it; falling back would just add latency and could re-trigger HTTP-loop scenarios in odd misconfigurations.

### Token refresh

`HttpClient.request` wraps `handleRequest` with 401-triggered token refresh. In-process dispatch does **not** participate in refresh: a function handler running inside the deployment uses whatever credentials the original incoming request carried, and silent token rotation across an internal call would mutate caller-visible auth state in surprising ways. If a handler returns 401, the caller sees 401 and decides what to do.

## Component 3: Type Declaration

New file `src/types/globals.d.ts`:

```ts
export {};

declare global {
  // eslint-disable-next-line no-var
  var __insforge_dispatch__:
    | ((req: Request) => Promise<Response>)
    | undefined;
}
```

This lets `globalThis.__insforge_dispatch__` be referenced directly without `as any` casts. The `export {}` keeps the file a module so `declare global` works.

Confirm `tsconfig.json` includes the file (typically picked up by default `include: ["src"]`); add explicitly only if needed.

## Error Handling Summary

| Scenario | Outcome |
|---|---|
| `dispatch` returns 2xx with JSON | `{ data, error: null }` |
| `dispatch` returns 2xx with non-JSON | `{ data: <text>, error: null }` |
| `dispatch` returns 204 | `{ data: undefined, error: null }` |
| `dispatch` returns non-2xx with `{ error, message }` body | `{ data: null, error: InsForgeError(status, code) }` (preserves all fields) |
| `dispatch` returns non-2xx with non-error body | `{ data: null, error: InsForgeError(status, 'REQUEST_FAILED') }` |
| `dispatch` returns 404 (slug not in routes) | Returned as error (no HTTP fallback) |
| `dispatch` throws synchronously or rejects | `{ data: null, error: InsForgeError(500, 'FUNCTION_ERROR') }` |
| `AbortError` propagates from caller-cancellation | re-throw, matches HTTP path |

## Backward Compatibility

| SDK | Router | Behavior |
|---|---|---|
| Old | Old | HTTP, loop bug present (status quo) |
| New | Old | HTTP (global absent → fallthrough), loop bug present until router updated |
| Old | New | HTTP (old SDK doesn't read global), loop bug present until SDK updated |
| New | New | In-process dispatch, no loop |

Both sides degrade safely. Mixed deployments work; no synchronized rollout required.

## Testing

New file `src/modules/__tests__/functions.test.ts`. Each test sets/clears `globalThis.__insforge_dispatch__` in setup/teardown. Mock `dispatch` with `jest.fn()` returning crafted `Response` objects.

| # | Setup | Assertion |
|---|---|---|
| 1 | No global, mock `http.request` returns data | Returns `{ data, error: null }`; HTTP path used (existing behavior preserved) |
| 2 | No global, mock `http.request` throws 404, then returns data on second call | Subhosting → proxy fallback (existing behavior preserved) |
| 3 | global present, dispatch returns `Response('{"x":1}', { headers: { 'content-type': 'application/json' } })` | Returns `{ data: { x: 1 }, error: null }`; underlying `fetch` mock **never called** |
| 4 | global present, dispatch returns 500 with `{"error":"E","message":"M"}` JSON | Returns `{ data: null, error }` with `error.statusCode === 500`, `error.error === 'E'` |
| 5 | global present, dispatch throws `new Error('boom')` | Returns `{ data: null, error: InsForgeError('boom', 500, 'FUNCTION_ERROR') }` |
| 6 | global present, body is `{ a: 1 }` | dispatch's received Request has `content-type: application/json`; `await req.json()` deep-equals `{ a: 1 }` |
| 7 | global present, options `headers: { Authorization: 'Bearer xyz' }` | dispatch's received Request has `Authorization: Bearer xyz` |
| 8 | global present, `slug = 'foo/bar'` | dispatch's received Request `new URL(req.url).pathname === '/foo/bar'` |
| 9 | global present, `method: 'GET'`, no body | dispatch's received Request has method `GET`, no `content-type` set by SDK |
| 10 | global present, dispatch returns 204 | Returns `{ data: undefined, error: null }` |

Existing HTTP-path tests (if any) must continue to pass unchanged.

## Out of Scope

- Cross-deployment function calls (different `appKey`s). Those go HTTP and don't trigger Deno's loop detection — current behavior is correct.
- Streaming responses. The current `invoke` API returns parsed `data`; streaming is a separate feature not changed here.
- Telemetry/metrics on in-process calls. Router's existing `console.log` line still fires (since the full router runs); no new instrumentation added.
- Changes to `isServerMode` semantics.

## Open Questions

None at design time. Implementation may surface minor decisions (e.g., exact placement of `parseResponse` — own file vs. exported from `http-client.ts`); resolve those during plan writing.
