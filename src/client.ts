import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import { SecureSessionStorage } from './lib/session-storage';
import { Auth } from './modules/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';
import { Realtime } from './modules/realtime';
import { Emails } from './modules/email';

/**
 * Check if the isAuthenticated cookie flag exists
 * This indicates the backend supports secure cookie-based auth
 */
function hasAuthenticatedCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some(c =>
    c.trim().startsWith('isAuthenticated=')
  );
}

/**
 * Main InsForge SDK Client
 * 
 * The client is synchronously constructed and immediately usable.
 * Storage strategy (localStorage vs secure/cookie-based) is automatically
 * detected based on backend behavior.
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
 * // Authentication
 * const { data, error } = await client.auth.signUp({
 *   email: 'user@example.com',
 *   password: 'password123',
 *   name: 'John Doe'
 * });
 * 
 * // Database operations
 * const { data } = await client.database
 *   .from('posts')
 *   .select('*')
 *   .limit(10);
 * 
 * // Invoke edge functions
 * const result = await client.functions.invoke('my-function', {
 *   body: { message: 'Hello' }
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
  public readonly realtime: Realtime;
  public readonly emails: Emails;

  constructor(config: InsForgeConfig = {}) {
    this.http = new HttpClient(config);
    this.tokenManager = new TokenManager(config.storage);

    // Detect storage strategy based on cookie flag
    // If isAuthenticated cookie exists, backend supports secure cookie mode
    if (hasAuthenticatedCookie()) {
      this.tokenManager.setStrategy(new SecureSessionStorage());
    }
    // Otherwise, keep default LocalSessionStorage

    // Check for edge function token (server-side usage)
    if (config.edgeFunctionToken) {
      this.http.setAuthToken(config.edgeFunctionToken);
      this.tokenManager.saveSession({
        accessToken: config.edgeFunctionToken,
        user: {} as any,
      });
    }

    this.auth = new Auth(this.http, this.tokenManager);

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
    } else if (this.tokenManager.getStrategyId() === 'secure') {
      // Secure mode but no session in memory - need to refresh
      // This happens on page reload with cookie auth
      // Will be handled by first API call triggering 401 -> refresh
    }

    // Initialize other modules
    this.database = new Database(this.http, this.tokenManager);
    this.storage = new Storage(this.http);
    this.ai = new AI(this.http);
    this.functions = new Functions(this.http);
    this.realtime = new Realtime(this.http.baseUrl, this.tokenManager);
    this.emails = new Emails(this.http);
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
   * Get the current storage strategy identifier
   */
  getStorageStrategy(): string {
    return this.tokenManager.getStrategyId();
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
