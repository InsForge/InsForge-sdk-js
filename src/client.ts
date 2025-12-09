import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import { SecureSessionStorage, AUTH_FLAG_COOKIE  } from './lib/session-storage';
import { Auth } from './modules/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';

/**
 * Check if the isAuthenticated cookie flag exists (SDK-managed on frontend domain)
 * This indicates a previous secure session was established and we should use SecureSessionStorage
 */
function hasAuthenticatedCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some(c =>
    c.trim().startsWith(`${AUTH_FLAG_COOKIE}=`)
  );
}

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
 * // Authentication
 * const { data, error } = await client.auth.signUp({
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
  public readonly auth: Auth;
  public readonly database: Database;
  public readonly storage: Storage;
  public readonly ai: AI;
  public readonly functions: Functions;

  constructor(config: InsForgeConfig = {}) {
    this.http = new HttpClient(config);
    this.tokenManager = new TokenManager(config.storage);

    // Detect storage strategy based on SDK-managed cookie flag (on frontend domain)
    // If isAuthenticated cookie exists, a previous secure session was established
    if (hasAuthenticatedCookie()) {
      this.tokenManager.setStrategy(new SecureSessionStorage());
    }
    // Otherwise, keep default LocalSessionStorage (will switch if backend returns sessionMode: 'secure')

    // Check for edge function token
    if (config.edgeFunctionToken) {
      this.http.setAuthToken(config.edgeFunctionToken);
      // Save to token manager so getCurrentUser() works
      this.tokenManager.saveSession({
        accessToken: config.edgeFunctionToken,
        user: {} as any, // Will be populated by getCurrentUser()
      });
    }

    // Set up refresh callback for auto-refresh on 401
    // On 401, if refresh fails and we're using SecureSessionStorage, 
    // fall back to LocalSessionStorage
    this.http.setRefreshCallback(async () => {
      try {
        return await this.auth.refreshToken();
      } catch {
        // If refresh failed and we're in secure mode, cookie might be invalid
        // Fall back to localStorage mode
        if (this.tokenManager.getStrategyId() === 'secure') {
          this.auth._switchToLocalStorage();
        }
        return null;
      }
    });

    // Check for existing session
    // In secure mode: try to refresh to get access token
    // In local mode: check localStorage
    const existingSession = this.tokenManager.getSession();
    if (existingSession?.accessToken) {
      this.http.setAuthToken(existingSession.accessToken);
    }

    this.auth = new Auth(this.http, this.tokenManager);
    this.database = new Database(this.http, this.tokenManager);
    this.storage = new Storage(this.http);
    this.ai = new AI(this.http);
    this.functions = new Functions(this.http);
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
   * Future modules will be added here:
   * - database: Database operations
   * - storage: File storage operations
   * - functions: Serverless functions
   * - tables: Table management
   * - metadata: Backend metadata
   */
}
