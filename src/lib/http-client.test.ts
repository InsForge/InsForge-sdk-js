import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpClient } from './http-client';
import { InsForgeError } from '../types';

describe('HttpClient retry and timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries retryable status codes with configured attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'TEMP', message: 'temporary failure', statusCode: 503 }),
          { status: 503, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'TEMP', message: 'temporary failure', statusCode: 503 }),
          { status: 503, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const client = new HttpClient({
      baseUrl: 'https://example.com',
      fetch: fetchMock as unknown as typeof fetch,
      retry: {
        retries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    const data = await client.get<{ ok: boolean }>('/api/test');

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws timeout error after configured timeout', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const client = new HttpClient({
      baseUrl: 'https://example.com',
      fetch: fetchMock as unknown as typeof fetch,
      requestTimeoutMs: 50,
      retry: { retries: 0 },
    });

    const requestPromise = client.get('/api/hang');
    const assertionPromise = expect(requestPromise).rejects.toMatchObject({
      name: 'InsForgeError',
      error: 'REQUEST_TIMEOUT',
      statusCode: 408,
    } satisfies Partial<InsForgeError>);

    await vi.advanceTimersByTimeAsync(50);
    await assertionPromise;
  });

  it('allows disabling retries per request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'TEMP', message: 'temporary failure', statusCode: 503 }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = new HttpClient({
      baseUrl: 'https://example.com',
      fetch: fetchMock as unknown as typeof fetch,
      retry: {
        retries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    await expect(client.get('/api/test', { retry: false })).rejects.toBeInstanceOf(InsForgeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST requests by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'TEMP', message: 'temporary failure', statusCode: 503 }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = new HttpClient({
      baseUrl: 'https://example.com',
      fetch: fetchMock as unknown as typeof fetch,
      retry: {
        retries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    await expect(client.post('/api/test', { data: 'value' })).rejects.toBeInstanceOf(InsForgeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately while waiting for retry backoff', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'TEMP', message: 'temporary failure', statusCode: 503 }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    );

    const client = new HttpClient({
      baseUrl: 'https://example.com',
      fetch: fetchMock as unknown as typeof fetch,
      retry: {
        retries: 1,
        initialDelayMs: 100,
        maxDelayMs: 100,
      },
    });

    const controller = new AbortController();
    const requestPromise = client.get('/api/test', { signal: controller.signal });

    await Promise.resolve();
    controller.abort();

    await expect(requestPromise).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
