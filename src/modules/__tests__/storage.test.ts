import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageBucket } from '../storage';
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

describe('StorageBucket.upload / uploadAuto (standard PUT semantics)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const storedFile = {
    bucket: 'docs',
    key: 'report.pdf',
    size: 3,
    mimeType: 'application/pdf',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    url: 'http://localhost:7130/api/storage/buckets/docs/objects/report.pdf',
  };

  it('uploads to the exact key via the direct PUT route, no upsert flag', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes(200, {
          method: 'direct',
          uploadUrl: '/api/storage/buckets/docs/objects/report.pdf',
          key: 'report.pdf',
          confirmRequired: false,
        })
      )
      .mockResolvedValueOnce(jsonRes(200, storedFile));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.upload('report.pdf', new Blob(['abc']));

    expect(result.error).toBeNull();
    const strategyBody = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(strategyBody.filename).toBe('report.pdf');
    expect(strategyBody).not.toHaveProperty('autoKey');
    expect(strategyBody).not.toHaveProperty('upsert');
    const putUrl = new URL(String(fetchFn.mock.calls[1][0]), 'http://localhost');
    expect(putUrl.pathname).toBe('/api/storage/buckets/docs/objects/report.pdf');
    expect(putUrl.search).toBe('');
    expect(String(fetchFn.mock.calls[1][1]?.method)).toBe('PUT');
  });

  it('surfaces a backend error as an InsForgeError', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonRes(
          403,
          { error: 'STORAGE_PERMISSION_DENIED', message: 'You do not have permission' },
          'Forbidden'
        )
      );
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.upload('report.pdf', new Blob(['abc']));

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(InsForgeError);
    expect(result.error?.statusCode).toBe(403);
  });

  it('confirms a presigned upload without an upsert flag', async () => {
    // The presigned upload itself goes through the global fetch, not the
    // injected HTTP client — stub it separately.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes(200, {
          method: 'presigned',
          uploadUrl: 'https://s3.example.com/upload',
          key: 'report.pdf',
          confirmRequired: true,
          confirmUrl: '/api/storage/buckets/docs/objects/report.pdf/confirm-upload',
        })
      )
      .mockResolvedValueOnce(jsonRes(200, storedFile)); // confirm
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));

    const result = await bucket.upload('report.pdf', new Blob(['abc']));
    vi.unstubAllGlobals();

    expect(result.error).toBeNull();
    const confirmBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(confirmBody).not.toHaveProperty('upsert');
    expect(confirmBody.size).toBe(3);
  });

  it('uploadAuto requests a server-generated key and uploads to that exact key', async () => {
    const generatedFile = {
      ...storedFile,
      key: 'report-123-abc.pdf',
      url: 'http://localhost:7130/api/storage/buckets/docs/objects/report-123-abc.pdf',
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes(200, {
          method: 'direct',
          uploadUrl: '/api/storage/buckets/docs/objects/report-123-abc.pdf',
          key: 'report-123-abc.pdf',
          confirmRequired: false,
        })
      )
      .mockResolvedValueOnce(jsonRes(200, generatedFile));
    const bucket = new StorageBucket('docs', makeHttp(fetchFn));
    const file = Object.assign(new Blob(['abc'], { type: 'application/pdf' }), {
      name: 'report.pdf',
    });

    const result = await bucket.uploadAuto(file);

    expect(result.error).toBeNull();
    expect(result.data?.key).toBe('report-123-abc.pdf');
    const strategyBody = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(strategyBody).toMatchObject({
      filename: 'report.pdf',
      contentType: 'application/pdf',
      size: 3,
      autoKey: true,
    });
    const putUrl = new URL(String(fetchFn.mock.calls[1][0]), 'http://localhost');
    expect(putUrl.pathname).toBe('/api/storage/buckets/docs/objects/report-123-abc.pdf');
    expect(putUrl.search).toBe('');
    expect(String(fetchFn.mock.calls[1][1]?.method)).toBe('PUT');
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
