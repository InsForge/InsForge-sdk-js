import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import { detectBackendCapabilities, getMinRefreshTokenVersion, StorageMode } from './lib/version-detector';
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
  private backendVersion = 'unknown';
  private storageMode: StorageMode = 'legacy';
  
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
      // Save to token manager so getCurrentUser() works
      this.tokenManager.saveSession({
        accessToken: config.edgeFunctionToken,
        user: {} as any // Will be populated by getCurrentUser()
      });
    }
    
    // Create auth module first (needed for refresh callback)
    this.auth = new Auth(
      this.http,
      this.tokenManager
    );
    
    // Set up refresh callback for auto-refresh on 401
    this.http.setRefreshCallback(async () => {
      try {
        return await this.auth.refreshToken();
      } catch {
        return null;
      }
    });
    
    // Check for existing session in storage (legacy mode initial load)
    const existingSession = this.tokenManager.getSession();
    if (existingSession?.accessToken) {
      this.http.setAuthToken(existingSession.accessToken);
    }
    
    this.database = new Database(this.http, this.tokenManager);
    this.storage = new Storage(this.http);
    this.ai = new AI(this.http);
    this.functions = new Functions(this.http);
    
    // Start async initialization (non-blocking)
    // Users can optionally await client.initialize() for full initialization
    this.initializationPromise = this.initializeAsync();
  }

  /**
   * Initialize the client by detecting backend capabilities
   * This is called automatically on construction but can be awaited for guaranteed initialization
   * 
   * @example
   * ```typescript
   * const client = new InsForgeClient({ baseUrl: 'https://api.example.com' });
   * await client.initialize(); // Wait for backend detection
   * ```
   */
  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Internal async initialization
   */
  private async initializeAsync(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const { mode, version } = await detectBackendCapabilities(
        this.http.baseUrl,
        this.http.fetch
      );
      
      this.backendVersion = version;
      this.storageMode = mode;
      this.tokenManager.setMode(mode);
      
      if (mode === 'modern') {
        await this.initializeModernSession();
      } else {
        this.initializeLegacySession();
      }
      
      this.initialized = true;
    } catch (error) {
      // If detection fails, continue with legacy mode
      console.warn('[InsForge] Backend detection failed, using legacy mode:', error);
      this.storageMode = 'legacy';
      this.tokenManager.setMode('legacy');
      this.initializeLegacySession();
      this.initialized = true;
    }
  }

  /**
   * Initialize session in modern mode
   * Attempts to refresh token if isAuthenticated flag exists
   */
  private async initializeModernSession(): Promise<void> {
    // Check isAuthenticated flag and attempt refresh
    if (this.tokenManager.shouldAttemptRefresh()) {
      try {
        const newToken = await this.auth.refreshToken();
        this.http.setAuthToken(newToken);
      } catch {
        // Refresh failed - session expired or invalid
        this.tokenManager.clearSession();
        this.http.setAuthToken(null);
      }
    }
  }

  /**
   * Initialize session in legacy mode
   * Loads existing session from localStorage
   */
  private initializeLegacySession(): void {
    const session = this.tokenManager.getSession();
    if (session?.accessToken) {
      this.http.setAuthToken(session.accessToken);
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
   * Get the detected backend version
   */
  getBackendVersion(): string {
    return this.backendVersion;
  }

  /**
   * Get the current storage mode
   */
  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  /**
   * Check if the client has been fully initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
