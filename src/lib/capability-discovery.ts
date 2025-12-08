/**
 * Backend Capability Discovery for InsForge SDK
 * 
 * Discovers backend capabilities via the /api/health endpoint
 * and creates appropriate storage strategies based on those capabilities.
 */

import type { TokenStorage } from '../types';
import {
  SessionStorageStrategy,
  SecureSessionStorage,
  PersistentSessionStorage,
} from './session-storage';

/**
 * Backend capabilities returned from /api/health
 */
export interface BackendCapabilities {
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
  capabilities?: BackendCapabilities;
}

/**
 * Default capabilities for legacy backends that don't return capabilities
 */
const DEFAULT_CAPABILITIES: BackendCapabilities = {
  secureSessionStorage: false,
  refreshTokens: false,
};

/**
 * Discover backend capabilities from the /api/health endpoint
 * 
 * This is the primary method for determining which features the backend supports.
 * The SDK uses this information to select appropriate storage strategies.
 * 
 * @param baseUrl - The backend base URL
 * @param fetchImpl - Optional custom fetch implementation
 * @returns Backend capabilities object
 * 
 * @example
 * ```typescript
 * const capabilities = await discoverCapabilities('https://api.example.com');
 * if (capabilities.secureSessionStorage) {
 *   // Use secure storage strategy
 * }
 * ```
 */
export async function discoverCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<BackendCapabilities> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return DEFAULT_CAPABILITIES;
    }

    const health: HealthResponse = await response.json();

    // If backend returns capabilities, use them
    if (health.capabilities) {
      return health.capabilities;
    }

    // Legacy backend without capabilities - use defaults
    return DEFAULT_CAPABILITIES;
  } catch {
    return DEFAULT_CAPABILITIES;
  }
}

/**
 * Create the appropriate session storage strategy based on backend capabilities
 * 
 * This is the factory function that implements the Strategy Pattern.
 * It selects the storage implementation based on what the backend supports.
 * 
 * @param capabilities - Backend capabilities from discoverCapabilities()
 * @param storage - Optional custom storage adapter (for PersistentSessionStorage)
 * @returns Appropriate SessionStorageStrategy implementation
 * 
 * @example
 * ```typescript
 * const capabilities = await discoverCapabilities(baseUrl);
 * const storage = createSessionStorage(capabilities);
 * storage.saveSession({ accessToken: '...', user: {...} });
 * ```
 */
export function createSessionStorage(
  capabilities: BackendCapabilities,
  storage?: TokenStorage
): SessionStorageStrategy {
  // Use secure storage when backend supports both httpOnly cookies and refresh
  if (capabilities.secureSessionStorage && capabilities.refreshTokens) {
    return new SecureSessionStorage();
  }

  // Fallback to persistent (localStorage) storage
  return new PersistentSessionStorage(storage);
}

/**
 * Get default capabilities (useful for testing or manual override)
 */
export function getDefaultCapabilities(): BackendCapabilities {
  return { ...DEFAULT_CAPABILITIES };
}
