import type { InsForgeConfig } from './types';
import { HttpClient } from './lib/http-client';
import { Logger } from './lib/logger';
import { AuthChangeEvent, TokenManager } from './lib/token-manager';
import { Auth } from './modules/auth/auth';
import { Database } from './modules/database-postgrest';
import { Storage } from './modules/storage';
import { AI } from './modules/ai';
import { Functions } from './modules/functions';
import { Realtime } from './modules/realtime';
import { Emails } from './modules/email';
import { Payments } from './modules/payments';

export type AccessTokenChangeEvent =
  typeof AuthChangeEvent.SIGNED_IN | typeof AuthChangeEvent.TOKEN_REFRESHED;

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
 *
 * // Enable debug logging
 * const debugClient = new InsForgeClient({
 *   baseUrl: 'http://localhost:7130',
 *   debug: true
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
  public readonly payments: Payments;

  constructor(config: InsForgeConfig = {}) {
    const logger = new Logger(config.debug);
    this.tokenManager = new TokenManager();
    this.http = new HttpClient(config, this.tokenManager, logger);

    // edgeFunctionToken is the deprecated alias for accessToken
    const accessToken = config.accessToken ?? config.edgeFunctionToken;
    if (accessToken) {
      this.http.setAuthToken(accessToken);
      this.tokenManager.setAccessToken(accessToken);
    }

    this.auth = new Auth(this.http, this.tokenManager, {
      isServerMode: config.isServerMode ?? !!accessToken,
      detectOAuthCallback: config.auth?.detectOAuthCallback,
    });
    this.database = new Database(this.http, config.db?.schema);
    this.storage = new Storage(this.http);
    this.ai = new AI(this.http);
    this.functions = new Functions(this.http, config.functionsUrl);
    this.realtime = new Realtime(this.http.baseUrl, this.tokenManager, config.anonKey, () =>
      this.http.getValidAccessToken()
    );
    this.emails = new Emails(this.http);
    this.payments = new Payments(this.http);
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
   * Set the access token used by every SDK surface. Updates both the HTTP
   * client (database / storage / functions / AI / emails) and the realtime
   * token manager. Pass `null` to sign out. By default a token replacement is
   * treated as a sign-in boundary and reconnects realtime. Pass
   * `AuthChangeEvent.TOKEN_REFRESHED` for a same-identity refresh to preserve a live socket; the
   * refreshed token is then used at the next handshake.
   *
   * Use this when an external auth provider (Better Auth, Clerk, Auth0,
   * WorkOS, Kinde, Stytch, …) issues the JWT and you need to keep the
   * long-lived InsForge client in sync. Without this, you'd have to call
   * `client.getHttpClient().setAuthToken(token)` AND reach into the private
   * realtime token manager separately.
   *
   * @example
   * ```typescript
   * import { AuthChangeEvent } from '@insforge/sdk';
   *
   * // Refresh a third-party-issued JWT periodically
   * const { token } = await fetch('/api/insforge-token').then((r) => r.json());
   * client.setAccessToken(token, AuthChangeEvent.TOKEN_REFRESHED);
   *
   * // Sign-out
   * client.setAccessToken(null);
   * ```
   */
  setAccessToken(
    token: string | null,
    event: AccessTokenChangeEvent = AuthChangeEvent.SIGNED_IN
  ): void {
    this.http.setAuthToken(token);
    if (token === null) {
      this.tokenManager.clearSession();
    } else {
      this.tokenManager.setAccessToken(token, event);
    }
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
