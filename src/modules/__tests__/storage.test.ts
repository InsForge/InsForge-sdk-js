import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import { StorageBucket, type StorageResponse } from '../storage';
import { HttpClient } from '../../lib/http-client';
import { InsForgeError } from '../../types';
import { TokenManager } from '../../lib/token-manager';
import type { DeleteObjectsResponse } from '@insforge/shared-schemas';

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
    makeTokenManager()
  );
}

function jsonRes(status: number, body: any, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('StorageBucket.getPublicUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { data: { publicUrl }, error } and makes no request', () => {
    const fetchFn = vi.fn();
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = bucket.getPublicUrl('images/logo.png');

    expect(result).toEqual({
      data: {
        publicUrl: 'http://localhost:7130/api/storage/buckets/docs/objects/images%2Flogo.png',
      },
      error: null,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('encodes special characters and nested paths', () => {
    const bucket = new StorageBucket('docs', makeHttp(vi.fn()));

    const { data } = bucket.getPublicUrl('files/my doc (1).pdf');

    expect(data?.publicUrl).toContain('docs');
    expect(data?.publicUrl).toContain('files%2Fmy%20doc%20(1).pdf');
  });
});

describe('StorageBucket.createSignedUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs the download-strategy endpoint with expiresIn and returns the signed URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonRes(200, {
        method: 'presigned',
        url: 'https://cdn.insforge.dev/storage/app/docs/invoice.pdf?Signature=abc',
        expiresAt: '2026-01-01T00:00:00.000Z',
      })
    );
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.createSignedUrl('invoice.pdf', 120);

    expect(result.error).toBeNull();
    expect(result.data?.signedUrl).toBe(
      'https://cdn.insforge.dev/storage/app/docs/invoice.pdf?Signature=abc'
    );
    expect(result.data?.expiresAt).toBe('2026-01-01T00:00:00.000Z');

    expect(fetchFn).toHaveBeenCalledOnce();
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/storage/buckets/docs/download-strategy/objects/invoice.pdf');
    expect(url.searchParams.get('expiresIn')).toBe('120');
  });

  it('defaults expiresIn to 3600 and returns expiresAt: null when absent', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { method: 'presigned', url: 'https://cdn.insforge.dev/x' }));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.createSignedUrl('x.pdf');

    expect(result.data?.signedUrl).toBe('https://cdn.insforge.dev/x');
    expect(result.data?.expiresAt).toBeNull();
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get('expiresIn')).toBe('3600');
  });

  it('maps a non-2xx response to { data: null, error: InsForgeError }', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonRes(404, { error: 'STORAGE_NOT_FOUND', message: 'Object not found' }, 'Not Found')
      );
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.createSignedUrl('missing.pdf');

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(InsForgeError);
    expect(result.error?.statusCode).toBe(404);
    // STORAGE_NOT_FOUND is a real miss, not a missing route — no POST fallback.
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('falls back to the legacy POST route when the GET route 404s on older backends', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(404, { error: 'NOT_FOUND', message: 'no route' }, 'Not Found'))
      .mockResolvedValueOnce(jsonRes(200, { method: 'presigned', url: 'https://cdn/ok' }));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.createSignedUrl('invoice.pdf', 120);

    expect(result.error).toBeNull();
    expect(result.data?.signedUrl).toBe('https://cdn/ok');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // First the canonical GET, then the legacy POST alias.
    expect(new URL(String(fetchFn.mock.calls[0][0])).pathname).toBe(
      '/api/storage/buckets/docs/download-strategy/objects/invoice.pdf'
    );
    expect(new URL(String(fetchFn.mock.calls[1][0])).pathname).toBe(
      '/api/storage/buckets/docs/objects/invoice.pdf/download-strategy'
    );
    expect(String(fetchFn.mock.calls[1][1]?.method)).toBe('POST');
  });
});

describe('StorageBucket.createSignedUrls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves each path independently; one failure does not fail the rest', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(200, { method: 'presigned', url: 'https://cdn/ok1' }))
      .mockResolvedValueOnce(
        jsonRes(404, { error: 'STORAGE_NOT_FOUND', message: 'nope' }, 'Not Found')
      )
      .mockResolvedValueOnce(jsonRes(200, { method: 'presigned', url: 'https://cdn/ok3' }));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.createSignedUrls(['a.pdf', 'missing.pdf', 'c.pdf'], 60);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { path: 'a.pdf', signedUrl: 'https://cdn/ok1', error: null },
      { path: 'missing.pdf', signedUrl: null, error: 'nope' },
      { path: 'c.pdf', signedUrl: 'https://cdn/ok3', error: null },
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('expiresIn')).toBe('60');
  });
});

describe('StorageBucket.remove', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a union-typed target', () => {
    const bucket = new StorageBucket('docs', makeHttp(vi.fn()));
    const remove = (target: string | string[]) => bucket.remove(target);

    expectTypeOf(remove).returns.toEqualTypeOf<
      Promise<StorageResponse<{ message: string } | DeleteObjectsResponse>>
    >();
  });

  it('deletes a single path with the single-object endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { message: 'Object deleted' }));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.remove('files/old report.pdf');

    expect(result).toEqual({ data: { message: 'Object deleted' }, error: null });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(new URL(String(fetchFn.mock.calls[0][0])).pathname).toBe(
      '/api/storage/buckets/docs/objects/files%2Fold%20report.pdf'
    );
    expect(fetchFn.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('deletes multiple paths in one request and returns the server results unchanged', async () => {
    const response = {
      results: [
        { key: 'a.pdf', status: 'deleted' },
        { key: 'missing.pdf', status: 'notFound' },
        { key: 'locked.pdf', status: 'failed', message: 'Delete denied' },
      ],
    } satisfies DeleteObjectsResponse;
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, response));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.remove(['a.pdf', 'missing.pdf', 'locked.pdf']);

    expect(result).toEqual({ data: response, error: null });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(new URL(String(fetchFn.mock.calls[0][0])).pathname).toBe(
      '/api/storage/buckets/docs/objects'
    );
    expect(fetchFn.mock.calls[0][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({
      keys: ['a.pdf', 'missing.pdf', 'locked.pdf'],
    });
  });

  it('surfaces a batch request error through the storage response envelope', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonRes(
          400,
          { error: 'STORAGE_ERROR', message: 'At least one object key is required' },
          'Bad Request'
        )
      );
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.remove([]);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(InsForgeError);
    expect(result.error?.statusCode).toBe(400);
    expect(result.error?.message).toBe('At least one object key is required');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('does not split arrays that exceed the server limit into multiple requests', async () => {
    const paths = Array.from({ length: 1001 }, (_, index) => `file-${index}.txt`);
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonRes(
          400,
          { error: 'STORAGE_ERROR', message: 'Cannot delete more than 1000 objects at once' },
          'Bad Request'
        )
      );
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.remove(paths);

    expect(result.data).toBeNull();
    expect(result.error?.statusCode).toBe(400);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).keys).toHaveLength(1001);
  });
});
