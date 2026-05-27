function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );

  if (typeof atob === 'function') {
    return atob(padded);
  }

  return Buffer.from(padded, 'base64').toString('utf8');
}

export function getJwtExpiration(token: string | null | undefined): Date | null {
  if (!token) return null;

  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) {
      return null;
    }
    return new Date(parsed.exp * 1000);
  } catch {
    return null;
  }
}

export function isJwtExpiredOrExpiring(
  token: string | null | undefined,
  leewaySeconds = 60,
): boolean {
  const expires = getJwtExpiration(token);
  if (!expires) return false;

  return expires.getTime() <= Date.now() + leewaySeconds * 1000;
}
