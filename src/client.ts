import { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { TokenManager } from './lib/token-manager';
import { Auth } from './modules/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';
import { Realtime } from './modules/realtime';
import { Emails } from './modules/email';

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
 * const session = await client.auth.register({
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
  public readonly realtime: Realtime;
  public readonly emails: Emails;

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
    
    // Check for existing session in storage
    const existingSession = this.tokenManager.getSession();
    if (existingSession?.accessToken) {
      this.http.setAuthToken(existingSession.accessToken);
    }
    
    this.auth = new Auth(
      this.http,
      this.tokenManager
    );
    
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
   * Future modules will be added here:
   * - database: Database operations
   * - storage: File storage operations
   * - functions: Serverless functions
   * - tables: Table management
   * - metadata: Backend metadata
   */
}