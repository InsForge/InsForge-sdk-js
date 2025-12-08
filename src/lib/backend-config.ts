/**
 * Backend Configuration for InsForge SDK
 * 
 * Fetches backend configuration via the /api/health endpoint
 * and creates appropriate storage strategies based on that configuration.
 */

import type { TokenStorage } from '../types';
import {
  SessionStorageStrategy,
  SecureSessionStorage,
  LocalSessionStorage,
} from './session-storage';

/**
 * Backend configuration returned from /api/health
 */
export interface BackendConfig {
  /** Whether backend supports secure httpOnly cookie storage for refresh tokens */
  secureSessionStorage: boolean;
  /** Whether backend supports token refresh endpoint */
  refreshTokens: boolean;
}

/**
 * Health endpoint response shape
 */
interface HealthResponse {
  status: string;
  version: string;
  service: string;
  timestamp: string;
  config?: BackendConfig;
}

/**
 * Default configuration for legacy backends
 */
const DEFAULT_CONFIG: BackendConfig = {
  secureSessionStorage: false,
  refreshTokens: false,
};

/**
 * Fetch backend configuration from the /api/health endpoint
 * 
 * This is the primary method for determining which features the backend supports.
 * The SDK uses this information to select appropriate storage strategies.
 * 
 * @param baseUrl - The backend base URL
 * @param fetchImpl - Optional custom fetch implementation
 * @returns Backend configuration object
 * 
 * @example
 * ```typescript
 * const config = await discoverBackendConfig('https://api.example.com');
 * if (config.secureSessionStorage) {
 *   // Use secure storage strategy
 * }
 * ```
 */
export async function discoverBackendConfig(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<BackendConfig> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return DEFAULT_CONFIG;
    }

    const health: HealthResponse = await response.json();

    // If backend returns config, use it
    if (health.config) {
      return health.config;
    }

    // Legacy backend without config - use defaults
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Create the appropriate session storage strategy based on backend configuration
 * 
 * This is the factory function that implements the Strategy Pattern.
 * It selects the storage implementation based on what the backend supports.
 * 
 * @param config - Backend configuration from discoverBackendConfig()
 * @param storage - Optional custom storage adapter (for LocalSessionStorage)
 * @returns Appropriate SessionStorageStrategy implementation
 * 
 * @example
 * ```typescript
 * const config = await discoverBackendConfig(baseUrl);
 * const storage = createSessionStorage(config);
 * storage.saveSession({ accessToken: '...', user: {...} });
 * ```
 */
export function createSessionStorage(
  config: BackendConfig,
  storage?: TokenStorage
): SessionStorageStrategy {
  // Use secure storage when backend supports both httpOnly cookies and refresh
  if (config.secureSessionStorage && config.refreshTokens) {
    return new SecureSessionStorage();
  }

  // Fallback to persistent (localStorage) storage
  return new LocalSessionStorage(storage);
}

/**
 * Get default backend configuration (useful for testing or manual override)
 */
export function getDefaultBackendConfig(): BackendConfig {
  return { ...DEFAULT_CONFIG };
}
