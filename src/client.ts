import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import {
  discoverBackendConfig,
  createSessionStorage,
  BackendConfig,
} from './lib/backend-config';
import { Auth } from './modules/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';

/**
 * Main InsForge SDK Client
 * 
 * The client automatically initializes in the background and emits auth state changes.
 * Subscribe to `auth.onAuthStateChange` to be notified when initialization completes.
 * 
 * @example
 * ```typescript
 * import { InsForgeClient } from '@insforge/sdk';
 * 
 * // Create client - synchronous, immediately usable
 * const client = new InsForgeClient({
 *   baseUrl: 'http://localhost:7130'
 * });
 * 
 * // Subscribe to auth state changes
 * client.auth.onAuthStateChange((event, session) => {
 *   console.log('Auth event:', event);
 *   if (session) {
 *     console.log('User:', session.user.email);
 *   }
 * });
 * 
 * // Client is immediately usable for auth operations
 * const { data, error } = await client.auth.signInWithPassword({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 * ```
 */
export class InsForgeClient {
  private http: HttpClient;
  private tokenManager: TokenManager;
  private backendConfig: BackendConfig | null = null;
  
  /**
   * Promise that resolves when initialization is complete.
   * Use this to ensure operations wait for the client to be ready.
   */
  private initializePromise: Promise<void>;
  private initializeResolve!: () => void;

  public readonly auth: Auth;
  public readonly database: Database;
  public readonly storage: Storage;
  public readonly ai: AI;
  public readonly functions: Functions;

  constructor(config: InsForgeConfig = {}) {
    // Create initialization promise
    this.initializePromise = new Promise((resolve) => {
      this.initializeResolve = resolve;
    });

    this.http = new HttpClient(config);
    this.tokenManager = new TokenManager(config.storage);

    // Create auth module with initializePromise for proper INITIAL_SESSION handling
    this.auth = new Auth(this.http, this.tokenManager, this.initializePromise);

    // Check for edge function token (server-side usage)
    if (config.edgeFunctionToken) {
      this.http.setAuthToken(config.edgeFunctionToken);
      // Save to token manager so getCurrentUser() works
      this.tokenManager.saveSession({
        accessToken: config.edgeFunctionToken,
        user: {} as any, // Will be populated by getCurrentUser()
      });
    }

    // Set up refresh callback for auto-refresh on 401
    this.http.setRefreshCallback(async () => {
      try {
        return await this.auth.refreshToken();
      } catch {
        return null;
      }
    });

    // Check for existing session in storage (for initial load)
    const existingSession = this.tokenManager.getSession();
    if (existingSession?.accessToken) {
      this.http.setAuthToken(existingSession.accessToken);
    }

    // Initialize other modules
    this.database = new Database(this.http, this.tokenManager);
    this.storage = new Storage(this.http);
    this.ai = new AI(this.http);
    this.functions = new Functions(this.http);

    // Start async initialization (fire and forget)
    // This will emit INITIAL_SESSION event when complete
    this._initializeAsync();
  }

  /**
   * Internal async initialization - discovers backend config and recovers session.
   * Emits INITIAL_SESSION event when complete.
   * @internal
   */
  private async _initializeAsync(): Promise<void> {
    try {
      // Discover backend configuration
      this.backendConfig = await discoverBackendConfig(
        this.http.baseUrl,
        this.http.fetch
      );

      // Create and set appropriate storage strategy
      const strategy = createSessionStorage(this.backendConfig);
      this.tokenManager.setStrategy(strategy);

      // Detect OAuth callback first (might set session)
      this.auth.detectAuthCallback();

      // Check if we already have a session from OAuth callback
      let currentSession = this.tokenManager.getSession();
      
      // If no session from OAuth but backend supports refresh tokens, try to recover
      if (!currentSession?.accessToken && this.backendConfig.refreshTokens) {
        if (this.tokenManager.shouldAttemptRefresh()) {
          try {
            await this.auth.refreshToken();
            currentSession = this.tokenManager.getSession();
          } catch {
            // Refresh failed - no valid session
            this.tokenManager.clearSession();
            this.http.setAuthToken(null);
          }
        }
      }

      // Mark initialization complete
      // Each subscriber will receive INITIAL_SESSION via onAuthStateChange
      // (following Supabase pattern - no broadcast here, each subscriber gets it individually)
      this.initializeResolve();
    } catch {
      // If discovery fails, continue with default (persistent) storage
      // Still detect OAuth callback
      this.auth.detectAuthCallback();
      
      // Mark initialization complete
      this.initializeResolve();
    }
  }

  /**
   * Wait for client initialization to complete
   * @returns Promise that resolves when initialization is done
   */
  async waitForInitialization(): Promise<void> {
    return this.initializePromise;
  }

  /**
   * Get the underlying HTTP client for custom requests
   */
  getHttpClient(): HttpClient {
    return this.http;
  }

  /**
   * Get the discovered backend configuration
   */
  getBackendConfig(): BackendConfig | null {
    return this.backendConfig;
  }

  /**
   * Get the current storage strategy identifier
   */
  getStorageStrategy(): string {
    return this.tokenManager.getStrategyId();
  }
}

/**
 * Create an InsForge client.
 * This is a convenience alias for `new InsForgeClient(config)`.
 * 
 * Note: The client initializes asynchronously in the background.
 * Subscribe to `auth.onAuthStateChange` to be notified when ready.
 * 
 * @example
 * ```typescript
 * import { createClient } from '@insforge/sdk';
 * 
 * const client = createClient({
 *   baseUrl: 'http://localhost:7130'
 * });
 * 
 * // Subscribe to auth state changes
 * client.auth.onAuthStateChange((event, session) => {
 *   if (event === 'INITIAL_SESSION') {
 *     // Initialization complete
 *     console.log('Ready!', session ? 'Logged in' : 'Not logged in');
 *   }
 * });
 * ```
 */
export function createClient(config: InsForgeConfig = {}): InsForgeClient {
  return new InsForgeClient(config);
}
