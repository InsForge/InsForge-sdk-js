import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCodeChallenge, generateCodeVerifier } from '../helpers';

// RFC 7636, Appendix B.
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('PKCE crypto helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses global Web Crypto without a Node runtime', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('process', undefined);

    expect(await generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await generateCodeChallenge(verifier)).toBe(challenge);
  });

  it.each([
    ['absent', undefined],
    ['incomplete', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }],
  ])('uses Node Web Crypto when global crypto is %s', async (_name, crypto) => {
    vi.stubGlobal('crypto', crypto);

    expect(await generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await generateCodeChallenge(verifier)).toBe(challenge);
  });

  it('rejects when neither Web Crypto nor Node is available', async () => {
    vi.stubGlobal('crypto', undefined);
    vi.stubGlobal('process', undefined);

    await expect(generateCodeVerifier()).rejects.toThrow(
      'Web Crypto API is not available in this environment'
    );
    await expect(generateCodeChallenge(verifier)).rejects.toThrow(
      'Web Crypto API is not available in this environment'
    );
  });
});
