import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import {
  discoverCapabilities,
  createSessionStorage,
  BackendCapabilities,
} from './lib/capability-discovery';
import { Auth } from './modules/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';

/**
 * Main InsForge SDK Client
 * 
 * @example
 * ```typescript
 * import { InsForgeClient } from '@insforge/sdk';
 * 
 * const client = new InsForgeClient({
 *   baseUrl: 'http://localhost:7130'
 * });
 * 
 * // Wait for initialization (optional but recommended)
 * await client.initialize();
 * 
 * // Authentication
 * const session = await client.auth.signUp({
 *   email: 'user@example.com',
 *   password: 'password123',
 *   name: 'John Doe'
 * });
 * 
 * // Database operations
 * const { data, error } = await client.database
 *   .from('posts')
 *   .select('*')
 *   .eq('user_id', session.user.id)
 *   .order('created_at', { ascending: false })
 *   .limit(10);
 * 
 * // Insert data
 * const { data: newPost } = await client.database
 *   .from('posts')
 *   .insert({ title: 'Hello', content: 'World' })
 *   .single();
 * 
 * // Invoke edge functions
 * const { data, error } = await client.functions.invoke('my-function', {
 *   body: { message: 'Hello from SDK' }
 * });
 * ```
 */
export class InsForgeClient {
  private http: HttpClient;
  private tokenManager: TokenManager;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private capabilities: BackendCapabilities | null = null;

  public readonly auth: Auth;
  public readonly database: Database;
  public readonly storage: Storage;
  public readonly ai: AI;
  public readonly functions: Functions;

  constructor(config: InsForgeConfig = {}) {
    this.http = new HttpClient(config);
    this.tokenManager = new TokenManager(config.storage);

    // Check for edge function token
    if (config.edgeFunctionToken) {
      this.http.setAuthToken(config.edgeFunctionToken);
      this.tokenManager.saveSession({
        accessToken: config.edgeFunctionToken,
        user: {} as any, // Will be populated by getCurrentUser()
      });
    }

    // Create auth module
    this.auth = new Auth(this.http, this.tokenManager);

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

    // Start async initialization (non-blocking)
    this.initializationPromise = this.initializeAsync();

    // Set init promise on auth module so auth operations wait for initialization
    this.auth.setInitPromise(this.initializationPromise);
  }

  /**
   * Initialize the client by discovering backend capabilities
   * This is called automatically on construction but can be awaited for guaranteed initialization
   * 
   * @example
   * ```typescript
   * const client = new InsForgeClient({ baseUrl: 'https://api.example.com' });
   * await client.initialize(); // Wait for capability discovery
   * ```
   */
  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Internal async initialization - discovers capabilities and configures storage strategy
   */
  private async initializeAsync(): Promise<void> {
    if (this.initialized) return;

    try {
      // Discover backend capabilities
      this.capabilities = await discoverCapabilities(
        this.http.baseUrl,
        this.http.fetch
      );

      // Create and set appropriate storage strategy
      const strategy = createSessionStorage(this.capabilities);
      this.tokenManager.setStrategy(strategy);

      // If secure storage and should attempt refresh, do so
      if (this.capabilities.refreshTokens && this.tokenManager.shouldAttemptRefresh()) {
        try {
          const newToken = await this.auth.refreshToken();
          this.http.setAuthToken(newToken);
        } catch {
          // Refresh failed - session expired or invalid
          this.tokenManager.clearSession();
          this.http.setAuthToken(null);
        }
      }

      this.initialized = true;
    } catch {
      // If discovery fails, continue with default (persistent) storage
      this.initialized = true;
    }
  }

  /**
   * Get the underlying HTTP client for custom requests
   * 
   * @example
   * ```typescript
   * const httpClient = client.getHttpClient();
   * const customData = await httpClient.get('/api/custom-endpoint');
   * ```
   */
  getHttpClient(): HttpClient {
    return this.http;
  }

  /**
   * Get the discovered backend capabilities
   */
  getCapabilities(): BackendCapabilities | null {
    return this.capabilities;
  }

  /**
   * Get the current storage strategy identifier
   */
  getStorageStrategy(): string {
    return this.tokenManager.getStrategyId();
  }

  /**
   * Check if the client has been fully initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
