import { UserSchema, CreateUserRequest, CreateUserResponse, CreateSessionRequest, CreateSessionResponse, GetCurrentSessionResponse, StorageFileSchema, ListObjectsResponseSchema } from '@insforge/shared-schemas';
export { AuthErrorResponse, CreateSessionRequest, CreateUserRequest, UserSchema } from '@insforge/shared-schemas';

/**
 * InsForge SDK Types - only SDK-specific types here
 * Use @insforge/shared-schemas directly for API types
 */

interface InsForgeConfig {
    /**
     * The URL of the InsForge backend API
     * @default "http://localhost:7130"
     */
    url?: string;
    /**
     * API key (optional)
     * Can be used for server-side operations or specific use cases
     */
    apiKey?: string;
    /**
     * Custom fetch implementation (useful for Node.js environments)
     */
    fetch?: typeof fetch;
    /**
     * Storage adapter for persisting tokens
     */
    storage?: TokenStorage;
    /**
     * Whether to automatically refresh tokens before they expire
     * @default true
     */
    autoRefreshToken?: boolean;
    /**
     * Whether to persist session in storage
     * @default true
     */
    persistSession?: boolean;
    /**
     * Custom headers to include with every request
     */
    headers?: Record<string, string>;
}
interface TokenStorage {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
}
interface AuthSession {
    user: UserSchema;
    accessToken: string;
    expiresAt?: Date;
}
interface ApiError {
    error: string;
    message: string;
    statusCode: number;
    nextActions?: string;
}
declare class InsForgeError extends Error {
    statusCode: number;
    error: string;
    nextActions?: string;
    constructor(message: string, statusCode: number, error: string, nextActions?: string);
    static fromApiError(apiError: ApiError): InsForgeError;
}

interface RequestOptions extends RequestInit {
    params?: Record<string, string>;
}
declare class HttpClient {
    readonly baseUrl: string;
    readonly fetch: typeof fetch;
    private defaultHeaders;
    constructor(config: InsForgeConfig);
    private buildUrl;
    request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
    get<T>(path: string, options?: RequestOptions): Promise<T>;
    post<T>(path: string, body?: any, options?: RequestOptions): Promise<T>;
    put<T>(path: string, body?: any, options?: RequestOptions): Promise<T>;
    patch<T>(path: string, body?: any, options?: RequestOptions): Promise<T>;
    delete<T>(path: string, options?: RequestOptions): Promise<T>;
    setAuthToken(token: string | null): void;
    getHeaders(): Record<string, string>;
}

declare class TokenManager {
    private storage;
    constructor(storage?: TokenStorage);
    saveSession(session: AuthSession): void;
    getSession(): AuthSession | null;
    getAccessToken(): string | null;
    clearSession(): void;
}

/**
 * Auth module for InsForge SDK
 * Uses shared schemas for type safety
 */

declare class Auth {
    private http;
    private tokenManager;
    constructor(http: HttpClient, tokenManager: TokenManager);
    /**
     * Sign up a new user
     */
    signUp(request: CreateUserRequest): Promise<{
        data: CreateUserResponse | null;
        error: InsForgeError | null;
    }>;
    /**
     * Sign in with email and password
     */
    signInWithPassword(request: CreateSessionRequest): Promise<{
        data: CreateSessionResponse | null;
        error: InsForgeError | null;
    }>;
    /**
     * Sign in with OAuth provider
     */
    signInWithOAuth(options: {
        provider: 'google' | 'github';
        redirectTo?: string;
        skipBrowserRedirect?: boolean;
    }): Promise<{
        data: {
            url?: string;
            provider?: string;
        };
        error: InsForgeError | null;
    }>;
    /**
     * Sign out the current user
     */
    signOut(): Promise<{
        error: InsForgeError | null;
    }>;
    /**
     * Get the current user from the API
     * Returns exactly what the backend returns: {id, email, role}
     */
    getCurrentUser(): Promise<{
        data: GetCurrentSessionResponse | null;
        error: InsForgeError | null;
    }>;
    /**
     * Get the stored session (no API call)
     */
    getSession(): Promise<{
        data: {
            session: AuthSession | null;
        };
        error: InsForgeError | null;
    }>;
}

/**
 * Database module for InsForge SDK
 * Supabase-style query builder for PostgREST operations
 */

interface DatabaseResponse<T> {
    data: T | null;
    error: InsForgeError | null;
    count?: number;
}
/**
 * Query builder for database operations
 * Uses method chaining like Supabase
 */
declare class QueryBuilder<T = any> {
    private table;
    private http;
    private method;
    private headers;
    private queryParams;
    private body?;
    constructor(table: string, http: HttpClient);
    /**
     * Perform a SELECT query
     * For mutations (insert/update/delete), this enables returning data
     * @param columns - Columns to select (default: '*')
     * @example
     * .select('*')
     * .select('id, title, content')
     * .insert({ title: 'New' }).select()  // Returns inserted data
     */
    select(columns?: string): this;
    /**
     * Perform an INSERT
     * @param values - Single object or array of objects
     * @param options - { upsert: true } for upsert behavior
     * @example
     * .insert({ title: 'Hello', content: 'World' }).select()
     * .insert([{ title: 'Post 1' }, { title: 'Post 2' }]).select()
     */
    insert(values: Partial<T> | Partial<T>[], options?: {
        upsert?: boolean;
    }): this;
    /**
     * Perform an UPDATE
     * @param values - Object with fields to update
     * @example
     * .update({ title: 'Updated Title' }).select()
     */
    update(values: Partial<T>): this;
    /**
     * Perform a DELETE
     * @example
     * .delete().select()
     */
    delete(): this;
    /**
     * Perform an UPSERT
     * @param values - Single object or array of objects
     * @example
     * .upsert({ id: 1, title: 'Hello' })
     */
    upsert(values: Partial<T> | Partial<T>[]): this;
    /**
     * Filter by column equal to value
     * @example .eq('id', 123)
     */
    eq(column: string, value: any): this;
    /**
     * Filter by column not equal to value
     * @example .neq('status', 'draft')
     */
    neq(column: string, value: any): this;
    /**
     * Filter by column greater than value
     * @example .gt('age', 18)
     */
    gt(column: string, value: any): this;
    /**
     * Filter by column greater than or equal to value
     * @example .gte('price', 100)
     */
    gte(column: string, value: any): this;
    /**
     * Filter by column less than value
     * @example .lt('stock', 10)
     */
    lt(column: string, value: any): this;
    /**
     * Filter by column less than or equal to value
     * @example .lte('discount', 50)
     */
    lte(column: string, value: any): this;
    /**
     * Filter by pattern matching (case-sensitive)
     * @example .like('email', '%@gmail.com')
     */
    like(column: string, pattern: string): this;
    /**
     * Filter by pattern matching (case-insensitive)
     * @example .ilike('name', '%john%')
     */
    ilike(column: string, pattern: string): this;
    /**
     * Filter by checking if column is a value
     * @example .is('deleted_at', null)
     */
    is(column: string, value: null | boolean): this;
    /**
     * Filter by checking if value is in array
     * @example .in('status', ['active', 'pending'])
     */
    in(column: string, values: any[]): this;
    /**
     * Order by column
     * @example
     * .order('created_at')  // ascending
     * .order('created_at', { ascending: false })  // descending
     */
    order(column: string, options?: {
        ascending?: boolean;
    }): this;
    /**
     * Limit the number of rows returned
     * @example .limit(10)
     */
    limit(count: number): this;
    /**
     * Return results from an offset
     * @example .offset(20)
     */
    offset(count: number): this;
    /**
     * Set a range of rows to return
     * @example .range(0, 9)  // First 10 rows
     */
    range(from: number, to: number): this;
    /**
     * Return a single object instead of array
     * @example .single()
     */
    single(): this;
    /**
     * Get the total count (use with select)
     * @example .select('*', { count: 'exact' })
     */
    count(algorithm?: 'exact' | 'planned' | 'estimated'): this;
    /**
     * Execute the query and return results
     */
    execute(): Promise<DatabaseResponse<T>>;
    /**
     * Make QueryBuilder thenable for async/await
     */
    then<TResult1 = DatabaseResponse<T>, TResult2 = never>(onfulfilled?: ((value: DatabaseResponse<T>) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
}
/**
 * Database client for InsForge SDK
 * Provides Supabase-style interface
 */
declare class Database {
    private http;
    constructor(http: HttpClient);
    /**
     * Create a query builder for a table
     * @param table - The table name
     * @example
     * const { data, error } = await client.database
     *   .from('posts')
     *   .select('*')
     *   .eq('user_id', userId)
     *   .order('created_at', { ascending: false })
     *   .limit(10);
     */
    from<T = any>(table: string): QueryBuilder<T>;
}

/**
 * Storage module for InsForge SDK
 * Handles file uploads, downloads, and bucket management
 */

interface StorageResponse<T> {
    data: T | null;
    error: InsForgeError | null;
}
/**
 * Storage bucket operations
 */
declare class StorageBucket {
    private bucketName;
    private http;
    constructor(bucketName: string, http: HttpClient);
    /**
     * Upload a file with a specific key
     * @param path - The object key/path
     * @param file - File, Blob, or FormData to upload
     */
    upload(path: string, file: File | Blob | FormData): Promise<StorageResponse<StorageFileSchema>>;
    /**
     * Upload a file with auto-generated key
     * @param file - File, Blob, or FormData to upload
     */
    uploadAuto(file: File | Blob | FormData): Promise<StorageResponse<StorageFileSchema>>;
    /**
     * Download a file
     * @param path - The object key/path
     * Returns the file as a Blob
     */
    download(path: string): Promise<{
        data: Blob | null;
        error: InsForgeError | null;
    }>;
    /**
     * Get public URL for a file
     * @param path - The object key/path
     */
    getPublicUrl(path: string): string;
    /**
     * List objects in the bucket
     * @param prefix - Filter by key prefix
     * @param search - Search in file names
     * @param limit - Maximum number of results (default: 100, max: 1000)
     * @param offset - Number of results to skip
     */
    list(options?: {
        prefix?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<StorageResponse<ListObjectsResponseSchema>>;
    /**
     * Delete a file
     * @param path - The object key/path
     */
    remove(path: string): Promise<StorageResponse<{
        message: string;
    }>>;
}
/**
 * Storage module for file operations
 */
declare class Storage {
    private http;
    constructor(http: HttpClient);
    /**
     * Get a bucket instance for operations
     * @param bucketName - Name of the bucket
     */
    from(bucketName: string): StorageBucket;
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
 * ```
 */
declare class InsForgeClient {
    private http;
    private tokenManager;
    readonly auth: Auth;
    readonly database: Database;
    readonly storage: Storage;
    constructor(config?: InsForgeConfig);
    /**
     * Set a custom API key for authentication
     * This is useful for server-to-server communication
     *
     * @param apiKey - The API key (should start with 'ik_')
     *
     * @example
     * ```typescript
     * client.setApiKey('ik_your_api_key_here');
     * ```
     */
    setApiKey(apiKey: string): void;
    /**
     * Get the underlying HTTP client for custom requests
     *
     * @example
     * ```typescript
     * const httpClient = client.getHttpClient();
     * const customData = await httpClient.get('/api/custom-endpoint');
     * ```
     */
    getHttpClient(): HttpClient;
}

/**
 * @insforge/sdk - TypeScript SDK for InsForge Backend-as-a-Service
 *
 * @packageDocumentation
 */

declare function createClient(config: InsForgeConfig): InsForgeClient;

export { type ApiError, Auth, type AuthSession, type InsForgeConfig as ClientOptions, Database, type DatabaseResponse, HttpClient, InsForgeClient, type InsForgeConfig, InsForgeError, QueryBuilder, Storage, StorageBucket, type StorageResponse, TokenManager, type TokenStorage, createClient, InsForgeClient as default };
