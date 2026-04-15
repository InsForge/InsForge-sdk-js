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
