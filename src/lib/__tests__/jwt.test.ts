import { describe, expect, it, vi } from 'vitest';
import { getJwtExpiration, getJwtSubject, isJwtExpiredOrExpiring } from '../jwt';

function jwtWithPayload(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encoded}.signature`;
}

describe('jwt helpers', () => {
  it('reads JWT exp without relying on Buffer', () => {
    const expiresAt = 1_800_000_000;
    const originalBuffer = globalThis.Buffer;

    try {
      vi.stubGlobal('Buffer', undefined);
      expect(getJwtExpiration(jwtWithPayload({ exp: expiresAt }))).toEqual(
        new Date(expiresAt * 1000)
      );
    } finally {
      vi.stubGlobal('Buffer', originalBuffer);
    }
  });

  it('returns null for malformed JWT expiration', () => {
    expect(getJwtExpiration('malformed.token')).toBeNull();
  });

  it('treats malformed JWTs as expiring for refresh decisions', () => {
    expect(isJwtExpiredOrExpiring('malformed.token')).toBe(true);
    expect(isJwtExpiredOrExpiring(null)).toBe(false);
  });

  it('reads the JWT subject claim', () => {
    expect(getJwtSubject(jwtWithPayload({ sub: 'user-1' }))).toBe('user-1');
  });

  it('returns null when the subject is missing, empty, or not a string', () => {
    expect(getJwtSubject(jwtWithPayload({ role: 'authenticated' }))).toBeNull();
    expect(getJwtSubject(jwtWithPayload({ sub: '' }))).toBeNull();
    expect(getJwtSubject(jwtWithPayload({ sub: 42 }))).toBeNull();
  });

  it('returns null for malformed tokens instead of throwing', () => {
    expect(getJwtSubject('malformed.token')).toBeNull();
    expect(getJwtSubject('no-dots-at-all')).toBeNull();
    expect(getJwtSubject(null)).toBeNull();
    expect(getJwtSubject(undefined)).toBeNull();
  });
});
