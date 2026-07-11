import { describe, it, expect, vi } from 'vitest';
import { InsForgeClient } from '../../client';
import { AuthChangeEvent, createAdminClient } from '../../index';

describe('client factories', () => {
  it('creates an admin client with the API key as bearer auth', () => {
    const client = createAdminClient({
      baseUrl: 'http://localhost:7130',
      apiKey: 'ik_test',
    });

    expect(client.getHttpClient().getHeaders().Authorization).toBe('Bearer ik_test');
  });

  it('requires apiKey on createAdminClient', () => {
    expect(() =>
      createAdminClient({
        baseUrl: 'http://localhost:7130',
      } as any)
    ).toThrow('Missing apiKey');
  });

  it('rejects blank apiKey on createAdminClient', () => {
    expect(() =>
      createAdminClient({
        baseUrl: 'http://localhost:7130',
        apiKey: '   ',
      })
    ).toThrow('Missing apiKey');
  });
});

describe('InsForgeClient – accessToken config', () => {
  it('seeds bearer auth and implies server mode', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const client = new InsForgeClient({
      baseUrl: 'http://localhost:7130',
      accessToken: fakeToken,
    });

    expect(client.getHttpClient().getHeaders().Authorization).toBe(`Bearer ${fakeToken}`);

    // Server path attempts a network call (no server running → error),
    // proving accessToken implies server mode just like the deprecated alias.
    const { error } = await client.auth.getCurrentUser();
    expect(error).not.toBeNull();
  });

  it('takes precedence over the deprecated edgeFunctionToken alias', () => {
    const client = new InsForgeClient({
      baseUrl: 'http://localhost:7130',
      accessToken: 'new-token',
      edgeFunctionToken: 'old-token',
    });

    expect(client.getHttpClient().getHeaders().Authorization).toBe('Bearer new-token');
  });
});

describe('InsForgeClient – edgeFunctionToken implies server mode', () => {
  it('should auto-enable server mode when edgeFunctionToken is provided', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const client = new InsForgeClient({
      baseUrl: 'http://localhost:7130',
      edgeFunctionToken: fakeToken,
    });

    // getCurrentUser() should take the server path (calls /api/auth/sessions/current)
    // rather than the browser path (checks session memory, tries cookie refresh).
    // Without the fix, this would silently return { user: null } because the browser
    // path finds no session and skips the cookie refresh (no window in Node).
    // With the fix, it hits the server endpoint — which will fail with a network error
    // since localhost:7130 isn't running, proving it took the server code path.
    const { error } = await client.auth.getCurrentUser();

    // In server mode with a token, the SDK attempts a network call to /api/auth/sessions/current.
    // Since there's no server, we expect an error (network/connection error), NOT a silent { user: null }.
    // A silent null user with no error would mean it took the browser path — the bug.
    expect(error).not.toBeNull();
  });

  it('should respect explicit isServerMode: false even with edgeFunctionToken', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const client = new InsForgeClient({
      baseUrl: 'http://localhost:7130',
      edgeFunctionToken: fakeToken,
      isServerMode: false,
    });

    // Explicit false overrides the auto-detection — browser path, silent null
    const { data, error } = await client.auth.getCurrentUser();
    expect(data.user).toBeNull();
    expect(error).toBeNull();
  });

  it('should default to browser mode when no edgeFunctionToken is provided', async () => {
    const client = new InsForgeClient({
      baseUrl: 'http://localhost:7130',
    });

    // No token, no server mode — browser path returns silent null
    const { data, error } = await client.auth.getCurrentUser();
    expect(data.user).toBeNull();
    expect(error).toBeNull();
  });
});

describe('InsForgeClient.setAccessToken', () => {
  it('exports auth change events as runtime constants', () => {
    expect(AuthChangeEvent).toEqual({
      SIGNED_IN: 'signedIn',
      SIGNED_OUT: 'signedOut',
      TOKEN_REFRESHED: 'tokenRefreshed',
    });
  });

  it('allows callers to mark an external token replacement as a refresh', () => {
    const client = new InsForgeClient({ baseUrl: 'http://localhost:7130' });
    const events: string[] = [];
    client.auth.onAuthStateChange((event) => events.push(event));

    client.setAccessToken('token-a');
    client.setAccessToken('token-b', AuthChangeEvent.TOKEN_REFRESHED);
    client.setAccessToken(null);
    expect(events).toEqual([
      AuthChangeEvent.SIGNED_IN,
      AuthChangeEvent.TOKEN_REFRESHED,
      AuthChangeEvent.SIGNED_OUT,
    ]);
  });

  it('allows each auth-state listener to unsubscribe independently', () => {
    const client = new InsForgeClient({ baseUrl: 'http://localhost:7130' });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = client.auth.onAuthStateChange(first);
    client.auth.onAuthStateChange(second);

    client.setAccessToken('same');
    unsubscribeFirst();
    client.setAccessToken('same');
    client.setAccessToken(null);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
