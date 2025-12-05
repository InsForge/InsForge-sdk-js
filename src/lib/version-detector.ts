/**
 * Version detector for InsForge SDK
 * Detects backend capabilities based on version number from /api/health endpoint
 */

// Minimum backend version that supports modern auth flow (refresh tokens + httpOnly cookies)
const MIN_REFRESH_TOKEN_VERSION = '1.2.7';

export type StorageMode = 'modern' | 'legacy';

export interface BackendCapabilities {
  mode: StorageMode;
  version: string;
}

interface HealthResponse {
  status: string;
  version: string;
  service: string;
  timestamp: string;
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Detect backend capabilities by checking the version from /api/health endpoint
 * This is the single source of truth for determining which auth flow to use
 */
export async function detectBackendCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<BackendCapabilities> {
  console.log(`[InsForge:VersionDetector] Checking backend capabilities at ${baseUrl}/api/health`);
  
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.warn(`[InsForge:VersionDetector] Health endpoint returned ${response.status}, assuming legacy mode`);
      return { mode: 'legacy', version: 'unknown' };
    }
    
    const health: HealthResponse = await response.json();
    const version = health.version || '1.0.0';
    
    console.log(`[InsForge:VersionDetector] Backend version: ${version}, minimum required: ${MIN_REFRESH_TOKEN_VERSION}`);
    
    // Compare against minimum version for refresh token support
    const supportsRefresh = compareVersions(version, MIN_REFRESH_TOKEN_VERSION) >= 0;
    const mode = supportsRefresh ? 'modern' : 'legacy';
    
    console.log(`[InsForge:VersionDetector] Version comparison result: ${supportsRefresh ? 'supports refresh' : 'does not support refresh'}, using ${mode} mode`);
    
    return { mode, version };
  } catch (error) {
    // Network error or invalid response - assume legacy for safety
    console.error('[InsForge:VersionDetector] Failed to detect backend capabilities:', error);
    return { mode: 'legacy', version: 'unknown' };
  }
}

/**
 * Get the minimum version required for modern auth flow
 */
export function getMinRefreshTokenVersion(): string {
  return MIN_REFRESH_TOKEN_VERSION;
}
