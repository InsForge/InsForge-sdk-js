import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('signInWithOAuth extraParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any stored verifiers
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  });

  it('merges extraParams into authorization URL', async () => {
    // Mock browser APIs
    const mockLocation = { href: '' };
    vi.stubGlobal('location', mockLocation);
    vi.stubGlobal('sessionStorage', {
      setItem: vi.fn(),
      getItem: vi.fn(),
      clear: vi.fn(),
    });

    const { AuthModule } = await import('./auth');
    const { InsForgeClient } = await import('../../client');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/v2/auth' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new InsForgeClient({
      apiUrl: 'https://test.insforge.io',
      apiKey: 'test-api-key',
    });

    await client.auth.signInWithOAuth({
      provider: 'google',
      extraParams: {
        prompt: 'select_account',
        access_type: 'offline',
      },
    });

    // Verify fetch was called with extra params in query string
    const callArgs = mockFetch.mock.calls[0];
    const url = callArgs[0];
    expect(url).toContain('prompt=select_account');
    expect(url).toContain('access_type=offline');
  });

  it('does not overwrite reserved params (code_challenge, redirect_uri)', async () => {
    const mockLocation = { href: '' };
    vi.stubGlobal('location', mockLocation);
    vi.stubGlobal('sessionStorage', {
      setItem: vi.fn(),
      getItem: vi.fn(),
      clear: vi.fn(),
    });

    // Clear module cache to get fresh import
    vi.resetModules();

    const { AuthModule } = await import('./auth');
    const { InsForgeClient } = await import('../../client');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://accounts.google.com/o/oauth2/v2/auth' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new InsForgeClient({
      apiUrl: 'https://test.insforge.io',
      apiKey: 'test-api-key',
    });

    await client.auth.signInWithOAuth({
      provider: 'google',
      extraParams: {
        code_challenge: 'malicious-value',
        redirect_uri: 'https://evil.com',
        prompt: 'select_account',
      },
    });

    const callArgs = mockFetch.mock.calls[0];
    const url = callArgs[0];
    
    // Should include the safe param
    expect(url).toContain('prompt=select_account');
    // Should NOT include the malicious overrides
    expect(url).not.toContain('code_challenge=malicious-value');
    expect(url).not.toContain('redirect_uri=https://evil.com');
  });
});
