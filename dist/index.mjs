// src/types.ts
var InsForgeError = class _InsForgeError extends Error {
  constructor(message, statusCode, error, nextActions) {
    super(message);
    this.name = "InsForgeError";
    this.statusCode = statusCode;
    this.error = error;
    this.nextActions = nextActions;
  }
  static fromApiError(apiError) {
    return new _InsForgeError(
      apiError.message,
      apiError.statusCode,
      apiError.error,
      apiError.nextActions
    );
  }
};

// src/lib/http-client.ts
var HttpClient = class {
  constructor(config) {
    this.baseUrl = config.url || "http://localhost:7130";
    this.fetch = config.fetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : void 0);
    this.defaultHeaders = {
      ...config.headers
    };
    if (config.apiKey) {
      this.defaultHeaders["Authorization"] = `Bearer ${config.apiKey}`;
    }
    if (!this.fetch) {
      throw new Error(
        "Fetch is not available. Please provide a fetch implementation in the config."
      );
    }
  }
  buildUrl(path, params) {
    const url = new URL(path, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    return url.toString();
  }
  async request(method, path, options = {}) {
    const { params, headers = {}, body, ...fetchOptions } = options;
    const url = this.buildUrl(path, params);
    const requestHeaders = {
      ...this.defaultHeaders
    };
    let processedBody;
    if (body !== void 0) {
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        processedBody = body;
      } else {
        if (method !== "GET") {
          requestHeaders["Content-Type"] = "application/json;charset=UTF-8";
        }
        processedBody = JSON.stringify(body);
      }
    }
    Object.assign(requestHeaders, headers);
    const response = await this.fetch(url, {
      method,
      headers: requestHeaders,
      body: processedBody,
      ...fetchOptions
    });
    if (response.status === 204) {
      return void 0;
    }
    let data;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    if (!response.ok) {
      if (data && typeof data === "object" && "error" in data) {
        throw InsForgeError.fromApiError(data);
      }
      throw new InsForgeError(
        `Request failed: ${response.statusText}`,
        response.status,
        "REQUEST_FAILED"
      );
    }
    return data;
  }
  get(path, options) {
    return this.request("GET", path, options);
  }
  post(path, body, options) {
    return this.request("POST", path, { ...options, body });
  }
  put(path, body, options) {
    return this.request("PUT", path, { ...options, body });
  }
  patch(path, body, options) {
    return this.request("PATCH", path, { ...options, body });
  }
  delete(path, options) {
    return this.request("DELETE", path, options);
  }
  setAuthToken(token) {
    if (token) {
      this.defaultHeaders["Authorization"] = `Bearer ${token}`;
    } else {
      delete this.defaultHeaders["Authorization"];
    }
  }
  getHeaders() {
    return { ...this.defaultHeaders };
  }
};

// src/lib/token-manager.ts
var TOKEN_KEY = "insforge-auth-token";
var USER_KEY = "insforge-auth-user";
var TokenManager = class {
  constructor(storage) {
    if (storage) {
      this.storage = storage;
    } else if (typeof window !== "undefined" && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      const store = /* @__PURE__ */ new Map();
      this.storage = {
        getItem: (key) => store.get(key) || null,
        setItem: (key, value) => {
          store.set(key, value);
        },
        removeItem: (key) => {
          store.delete(key);
        }
      };
    }
  }
  saveSession(session) {
    this.storage.setItem(TOKEN_KEY, session.accessToken);
    this.storage.setItem(USER_KEY, JSON.stringify(session.user));
  }
  getSession() {
    const token = this.storage.getItem(TOKEN_KEY);
    const userStr = this.storage.getItem(USER_KEY);
    if (!token || !userStr) {
      return null;
    }
    try {
      const user = JSON.parse(userStr);
      return { accessToken: token, user };
    } catch {
      this.clearSession();
      return null;
    }
  }
  getAccessToken() {
    const token = this.storage.getItem(TOKEN_KEY);
    return typeof token === "string" ? token : null;
  }
  clearSession() {
    this.storage.removeItem(TOKEN_KEY);
    this.storage.removeItem(USER_KEY);
  }
};

// src/modules/auth.ts
var Auth = class {
  constructor(http, tokenManager) {
    this.http = http;
    this.tokenManager = tokenManager;
  }
  /**
   * Sign up a new user
   */
  async signUp(request) {
    try {
      const response = await this.http.post("/api/auth/users", request);
      const session = {
        accessToken: response.accessToken,
        user: response.user
      };
      this.tokenManager.saveSession(session);
      this.http.setAuthToken(response.accessToken);
      return {
        data: response,
        error: null
      };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }
      return {
        data: null,
        error: new InsForgeError(
          error instanceof Error ? error.message : "An unexpected error occurred during sign up",
          500,
          "UNEXPECTED_ERROR"
        )
      };
    }
  }
  /**
   * Sign in with email and password
   */
  async signInWithPassword(request) {
    try {
      const response = await this.http.post("/api/auth/sessions", request);
      const session = {
        accessToken: response.accessToken,
        user: response.user
      };
      this.tokenManager.saveSession(session);
      this.http.setAuthToken(response.accessToken);
      return {
        data: response,
        error: null
      };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }
      return {
        data: null,
        error: new InsForgeError(
          "An unexpected error occurred during sign in",
          500,
          "UNEXPECTED_ERROR"
        )
      };
    }
  }
  /**
   * Sign in with OAuth provider
   */
  async signInWithOAuth(options) {
    try {
      const { provider, redirectTo, skipBrowserRedirect } = options;
      const params = redirectTo ? { redirect_uri: redirectTo } : void 0;
      const endpoint = `/api/auth/oauth/${provider}`;
      const response = await this.http.get(endpoint, { params });
      if (typeof window !== "undefined" && !skipBrowserRedirect) {
        window.location.href = response.authUrl;
        return { data: {}, error: null };
      }
      return {
        data: {
          url: response.authUrl,
          provider
        },
        error: null
      };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: {}, error };
      }
      return {
        data: {},
        error: new InsForgeError(
          "An unexpected error occurred during OAuth initialization",
          500,
          "UNEXPECTED_ERROR"
        )
      };
    }
  }
  /**
   * Sign out the current user
   */
  async signOut() {
    try {
      this.tokenManager.clearSession();
      this.http.setAuthToken(null);
      return { error: null };
    } catch (error) {
      return {
        error: new InsForgeError(
          "Failed to sign out",
          500,
          "SIGNOUT_ERROR"
        )
      };
    }
  }
  /**
   * Get the current user from the API
   * Returns exactly what the backend returns: {id, email, role}
   */
  async getCurrentUser() {
    try {
      const session = this.tokenManager.getSession();
      if (!session?.accessToken) {
        return { data: null, error: null };
      }
      this.http.setAuthToken(session.accessToken);
      const response = await this.http.get("/api/auth/sessions/current");
      return {
        data: response,
        error: null
      };
    } catch (error) {
      if (error instanceof InsForgeError && error.statusCode === 401) {
        await this.signOut();
        return { data: null, error: null };
      }
      if (error instanceof InsForgeError) {
        return { data: null, error };
      }
      return {
        data: null,
        error: new InsForgeError(
          "An unexpected error occurred while fetching user",
          500,
          "UNEXPECTED_ERROR"
        )
      };
    }
  }
  /**
   * Get the stored session (no API call)
   */
  async getSession() {
    try {
      const session = this.tokenManager.getSession();
      if (session?.accessToken) {
        this.http.setAuthToken(session.accessToken);
        return { data: { session }, error: null };
      }
      return { data: { session: null }, error: null };
    } catch (error) {
      if (error instanceof InsForgeError) {
        return { data: { session: null }, error };
      }
      return {
        data: { session: null },
        error: new InsForgeError(
          "An unexpected error occurred while getting session",
          500,
          "UNEXPECTED_ERROR"
        )
      };
    }
  }
};

// src/modules/database.ts
var QueryBuilder = class {
  constructor(table, http) {
    this.table = table;
    this.http = http;
    this.method = "GET";
    this.headers = {};
    this.queryParams = {};
  }
  /**
   * Perform a SELECT query
   * For mutations (insert/update/delete), this enables returning data
   * @param columns - Columns to select (default: '*')
   * @example
   * .select('*')
   * .select('id, title, content')
   * .insert({ title: 'New' }).select()  // Returns inserted data
   */
  select(columns = "*") {
    if (this.method !== "GET") {
      const existingPrefer = this.headers["Prefer"] || "";
      const preferParts = existingPrefer ? [existingPrefer] : [];
      if (!preferParts.some((p) => p.includes("return="))) {
        preferParts.push("return=representation");
      }
      this.headers["Prefer"] = preferParts.join(",");
    }
    if (columns !== "*") {
      this.queryParams.select = columns;
    }
    return this;
  }
  /**
   * Perform an INSERT
   * @param values - Single object or array of objects
   * @param options - { upsert: true } for upsert behavior
   * @example
   * .insert({ title: 'Hello', content: 'World' }).select()
   * .insert([{ title: 'Post 1' }, { title: 'Post 2' }]).select()
   */
  insert(values, options) {
    this.method = "POST";
    this.body = Array.isArray(values) ? values : [values];
    if (options?.upsert) {
      this.headers["Prefer"] = "resolution=merge-duplicates";
    }
    return this;
  }
  /**
   * Perform an UPDATE
   * @param values - Object with fields to update
   * @example
   * .update({ title: 'Updated Title' }).select()
   */
  update(values) {
    this.method = "PATCH";
    this.body = values;
    return this;
  }
  /**
   * Perform a DELETE
   * @example
   * .delete().select()
   */
  delete() {
    this.method = "DELETE";
    return this;
  }
  /**
   * Perform an UPSERT
   * @param values - Single object or array of objects
   * @example
   * .upsert({ id: 1, title: 'Hello' })
   */
  upsert(values) {
    return this.insert(values, { upsert: true });
  }
  // FILTERS
  /**
   * Filter by column equal to value
   * @example .eq('id', 123)
   */
  eq(column, value) {
    this.queryParams[column] = `eq.${value}`;
    return this;
  }
  /**
   * Filter by column not equal to value
   * @example .neq('status', 'draft')
   */
  neq(column, value) {
    this.queryParams[column] = `neq.${value}`;
    return this;
  }
  /**
   * Filter by column greater than value
   * @example .gt('age', 18)
   */
  gt(column, value) {
    this.queryParams[column] = `gt.${value}`;
    return this;
  }
  /**
   * Filter by column greater than or equal to value
   * @example .gte('price', 100)
   */
  gte(column, value) {
    this.queryParams[column] = `gte.${value}`;
    return this;
  }
  /**
   * Filter by column less than value
   * @example .lt('stock', 10)
   */
  lt(column, value) {
    this.queryParams[column] = `lt.${value}`;
    return this;
  }
  /**
   * Filter by column less than or equal to value
   * @example .lte('discount', 50)
   */
  lte(column, value) {
    this.queryParams[column] = `lte.${value}`;
    return this;
  }
  /**
   * Filter by pattern matching (case-sensitive)
   * @example .like('email', '%@gmail.com')
   */
  like(column, pattern) {
    this.queryParams[column] = `like.${pattern}`;
    return this;
  }
  /**
   * Filter by pattern matching (case-insensitive)
   * @example .ilike('name', '%john%')
   */
  ilike(column, pattern) {
    this.queryParams[column] = `ilike.${pattern}`;
    return this;
  }
  /**
   * Filter by checking if column is a value
   * @example .is('deleted_at', null)
   */
  is(column, value) {
    if (value === null) {
      this.queryParams[column] = "is.null";
    } else {
      this.queryParams[column] = `is.${value}`;
    }
    return this;
  }
  /**
   * Filter by checking if value is in array
   * @example .in('status', ['active', 'pending'])
   */
  in(column, values) {
    this.queryParams[column] = `in.(${values.join(",")})`;
    return this;
  }
  // MODIFIERS
  /**
   * Order by column
   * @example 
   * .order('created_at')  // ascending
   * .order('created_at', { ascending: false })  // descending
   */
  order(column, options) {
    const ascending = options?.ascending !== false;
    this.queryParams.order = ascending ? column : `${column}.desc`;
    return this;
  }
  /**
   * Limit the number of rows returned
   * @example .limit(10)
   */
  limit(count) {
    this.queryParams.limit = count.toString();
    return this;
  }
  /**
   * Return results from an offset
   * @example .offset(20)
   */
  offset(count) {
    this.queryParams.offset = count.toString();
    return this;
  }
  /**
   * Set a range of rows to return
   * @example .range(0, 9)  // First 10 rows
   */
  range(from, to) {
    this.headers["Range"] = `${from}-${to}`;
    return this;
  }
  /**
   * Return a single object instead of array
   * @example .single()
   */
  single() {
    this.headers["Accept"] = "application/vnd.pgrst.object+json";
    return this;
  }
  /**
   * Get the total count (use with select)
   * @example .select('*', { count: 'exact' })
   */
  count(algorithm = "exact") {
    const prefer = this.headers["Prefer"] || "";
    this.headers["Prefer"] = prefer ? `${prefer},count=${algorithm}` : `count=${algorithm}`;
    return this;
  }
  /**
   * Execute the query and return results
   */
  async execute() {
    try {
      const path = `/api/database/records/${this.table}`;
      let response;
      switch (this.method) {
        case "GET":
          response = await this.http.get(path, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
        case "POST":
          response = await this.http.post(path, this.body, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
        case "PATCH":
          response = await this.http.patch(path, this.body, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
        case "DELETE":
          response = await this.http.delete(path, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
      }
      return { data: response, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "Database operation failed",
          500,
          "DATABASE_ERROR"
        )
      };
    }
  }
  /**
   * Make QueryBuilder thenable for async/await
   */
  then(onfulfilled, onrejected) {
    return this.execute().then(onfulfilled, onrejected);
  }
};
var Database = class {
  constructor(http) {
    this.http = http;
  }
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
  from(table) {
    return new QueryBuilder(table, this.http);
  }
};

// src/modules/storage.ts
var StorageBucket = class {
  constructor(bucketName, http) {
    this.bucketName = bucketName;
    this.http = http;
  }
  /**
   * Upload a file with a specific key
   * @param path - The object key/path
   * @param file - File, Blob, or FormData to upload
   */
  async upload(path, file) {
    try {
      const formData = file instanceof FormData ? file : new FormData();
      if (!(file instanceof FormData)) {
        formData.append("file", file);
      }
      const response = await this.http.request(
        "PUT",
        `/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`,
        {
          body: formData,
          headers: {
            // Don't set Content-Type, let browser set multipart boundary
          }
        }
      );
      return { data: response, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "Upload failed",
          500,
          "STORAGE_ERROR"
        )
      };
    }
  }
  /**
   * Upload a file with auto-generated key
   * @param file - File, Blob, or FormData to upload
   */
  async uploadAuto(file) {
    try {
      const formData = file instanceof FormData ? file : new FormData();
      if (!(file instanceof FormData)) {
        formData.append("file", file);
      }
      const response = await this.http.request(
        "POST",
        `/api/storage/buckets/${this.bucketName}/objects`,
        {
          body: formData,
          headers: {
            // Don't set Content-Type, let browser set multipart boundary
          }
        }
      );
      return { data: response, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "Upload failed",
          500,
          "STORAGE_ERROR"
        )
      };
    }
  }
  /**
   * Download a file
   * @param path - The object key/path
   * Returns the file as a Blob
   */
  async download(path) {
    try {
      const url = `${this.http.baseUrl}/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`;
      const response = await this.http.fetch(url, {
        method: "GET",
        headers: this.http.getHeaders()
      });
      if (!response.ok) {
        try {
          const error = await response.json();
          throw InsForgeError.fromApiError(error);
        } catch {
          throw new InsForgeError(
            `Download failed: ${response.statusText}`,
            response.status,
            "STORAGE_ERROR"
          );
        }
      }
      const blob = await response.blob();
      return { data: blob, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "Download failed",
          500,
          "STORAGE_ERROR"
        )
      };
    }
  }
  /**
   * Get public URL for a file
   * @param path - The object key/path
   */
  getPublicUrl(path) {
    return `${this.http.baseUrl}/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`;
  }
  /**
   * List objects in the bucket
   * @param prefix - Filter by key prefix
   * @param search - Search in file names
   * @param limit - Maximum number of results (default: 100, max: 1000)
   * @param offset - Number of results to skip
   */
  async list(options) {
    try {
      const params = {};
      if (options?.prefix) params.prefix = options.prefix;
      if (options?.search) params.search = options.search;
      if (options?.limit) params.limit = options.limit.toString();
      if (options?.offset) params.offset = options.offset.toString();
      const response = await this.http.get(
        `/api/storage/buckets/${this.bucketName}/objects`,
        { params }
      );
      return { data: response, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "List failed",
          500,
          "STORAGE_ERROR"
        )
      };
    }
  }
  /**
   * Delete a file
   * @param path - The object key/path
   */
  async remove(path) {
    try {
      const response = await this.http.delete(
        `/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`
      );
      return { data: response, error: null };
    } catch (error) {
      return {
        data: null,
        error: error instanceof InsForgeError ? error : new InsForgeError(
          "Delete failed",
          500,
          "STORAGE_ERROR"
        )
      };
    }
  }
};
var Storage = class {
  constructor(http) {
    this.http = http;
  }
  /**
   * Get a bucket instance for operations
   * @param bucketName - Name of the bucket
   */
  from(bucketName) {
    return new StorageBucket(bucketName, this.http);
  }
};

// src/client.ts
var InsForgeClient = class {
  constructor(config = {}) {
    this.http = new HttpClient(config);
    this.tokenManager = new TokenManager(config.storage);
    this.auth = new Auth(
      this.http,
      this.tokenManager
    );
    this.database = new Database(this.http);
    this.storage = new Storage(this.http);
  }
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
  setApiKey(apiKey) {
    this.http.setAuthToken(apiKey);
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
  getHttpClient() {
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
};

// src/index.ts
function createClient(config) {
  return new InsForgeClient(config);
}
var index_default = InsForgeClient;
export {
  Auth,
  Database,
  HttpClient,
  InsForgeClient,
  InsForgeError,
  QueryBuilder,
  Storage,
  StorageBucket,
  TokenManager,
  createClient,
  index_default as default
};
//# sourceMappingURL=index.mjs.map