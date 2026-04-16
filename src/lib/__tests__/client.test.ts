import { describe, it, expect } from 'vitest';
import { InsForgeClient } from '../../client';

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
    const { data, error } = await client.auth.getCurrentUser();

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
