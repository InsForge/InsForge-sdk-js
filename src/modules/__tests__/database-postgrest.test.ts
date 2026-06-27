import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Database } from '../database-postgrest';
import { HttpClient } from '../../lib/http-client';
import { TokenManager } from '../../lib/token-manager';

function jsonResponse(status: number, body: unknown, statusText = 'OK') {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDatabase(
  fetchFn: ReturnType<typeof vi.fn>,
  overrides: Record<string, unknown> = {},
  accessToken: string | null = 'old-token',
  defaultSchema?: string,
) {
  const tokenManager = new TokenManager();
  if (accessToken) {
    tokenManager.setAccessToken(accessToken);
  }

  const http = new HttpClient(
    {
      baseUrl: 'http://localhost:7130',
      fetch: fetchFn as any,
      retryCount: 0,
      timeout: 0,
      ...overrides,
    },
    tokenManager,
  );
  http.setAuthToken(accessToken);

  return {
    database: new Database(http, defaultSchema),
    tokenManager,
  };
}

const refreshedUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'authenticated',
} as any;

describe('Database PostgREST auth refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the access token and retries a table query on 401 AUTH_UNAUTHORIZED', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          401,
          {
            error: 'AUTH_UNAUTHORIZED',
            message: 'Invalid token',
            statusCode: 401,
          },
          'Unauthorized',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'new-token', user: refreshedUser }),
      )
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 1 }]));

    const { database, tokenManager } = makeDatabase(fetchFn);

    const { data, error } = await database.from('todos').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://localhost:7130/api/auth/refresh',
    );
    expect(fetchFn.mock.calls[1][1].credentials).toBe('include');
    expect(
      new Headers(fetchFn.mock.calls[2][1].headers).get('Authorization'),
    ).toBe('Bearer new-token');
    expect(tokenManager.getAccessToken()).toBe('new-token');
  });

  it('refreshes the access token and retries a table query on PostgREST PGRST301', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          401,
          {
            code: 'PGRST301',
            message: 'JWT expired',
            details: 'Unauthorized',
            hint: null,
          },
          'Unauthorized',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'new-token', user: refreshedUser }),
      )
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 1 }]));

    const { database, tokenManager } = makeDatabase(fetchFn);

    const { data, error } = await database.from('todos').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://localhost:7130/api/auth/refresh',
    );
    expect(
      new Headers(fetchFn.mock.calls[2][1].headers).get('Authorization'),
    ).toBe('Bearer new-token');
    expect(tokenManager.getAccessToken()).toBe('new-token');
  });

  it('does not refresh database requests when no user token was sent', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        401,
        {
          error: 'AUTH_UNAUTHORIZED',
          message: 'No token provided',
          statusCode: 401,
        },
        'Unauthorized',
      ),
    );

    const { database } = makeDatabase(fetchFn, {}, null);

    const { data, error } = await database.from('todos').select('id');

    expect(data).toBeNull();
    expect(error).toMatchObject({
      message: 'No token provided',
      error: 'AUTH_UNAUTHORIZED',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('sends Accept-Profile when a schema is selected on a read', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(200, [{ id: 1 }]));
    const { database } = makeDatabase(fetchFn);

    await database.schema('analytics').from('events').select('id');

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://localhost:7130/api/database/records/events?select=id');
    expect(new Headers(init.headers).get('Accept-Profile')).toBe('analytics');
  });

  it('sends Content-Profile when a schema is selected on a write', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(201, [{ id: 1 }]));
    const { database } = makeDatabase(fetchFn);

    await database.schema('analytics').from('events').insert({ name: 'signup' });

    const [, init] = fetchFn.mock.calls[0];
    expect(new Headers(init.headers).get('Content-Profile')).toBe('analytics');
  });

  it('applies a default schema from config to every query', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(200, [{ id: 1 }]));
    const { database } = makeDatabase(fetchFn, {}, 'old-token', 'analytics');

    await database.from('events').select('id');

    const [, init] = fetchFn.mock.calls[0];
    expect(new Headers(init.headers).get('Accept-Profile')).toBe('analytics');
  });

  it('does not refresh database requests in server mode', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        401,
        {
          error: 'AUTH_UNAUTHORIZED',
          message: 'Invalid token',
          statusCode: 401,
        },
        'Unauthorized',
      ),
    );

    const { database } = makeDatabase(fetchFn, { isServerMode: true });

    const { data, error } = await database.from('todos').select('id');

    expect(data).toBeNull();
    expect(error).toMatchObject({
      message: 'Invalid token',
      error: 'AUTH_UNAUTHORIZED',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(
      new Headers(fetchFn.mock.calls[0][1].headers).get('Authorization'),
    ).toBe('Bearer old-token');
  });
});
