/**
 * Database module using @supabase/postgrest-js
 * Complete replacement for custom QueryBuilder with full PostgREST features
 */

import { PostgrestClient } from '@supabase/postgrest-js';
import { HttpClient } from '../lib/http-client';
import { TokenManager } from '../lib/token-manager';


/**
 * Custom fetch that transforms URLs and adds auth
 */
function createInsForgePostgrestFetch(
  httpClient: HttpClient,
  tokenManager: TokenManager
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const urlObj = new URL(url);

    // Extract pathname (remove leading /)
    // postgrest-js sends: http://dummy/tablename?params for tables
    // postgrest-js sends: http://dummy/rpc/functionname?params for RPC
    const pathname = urlObj.pathname.slice(1);

    // Route to appropriate InsForge endpoint
    const rpcMatch = pathname.match(/^rpc\/(.+)$/);
    const endpoint = rpcMatch
      ? `/api/database/rpc/${rpcMatch[1]}`
      : `/api/database/records/${pathname}`;

    const insforgeUrl = `${httpClient.baseUrl}${endpoint}${urlObj.search}`;
    
    // Get auth token from TokenManager or HttpClient
    const token = tokenManager.getAccessToken();
    const httpHeaders = httpClient.getHeaders();
    const authToken = token || httpHeaders['Authorization']?.replace('Bearer ', '');
    
    // Prepare headers
    const headers = new Headers(init?.headers);
    if (authToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    
    // Make the actual request using native fetch
    const response = await fetch(insforgeUrl, {
      ...init,
      headers
    });
  
    return response;
  };
}

/**
 * Database client using postgrest-js
 * Drop-in replacement with FULL PostgREST capabilities
 */
export class Database {
  private postgrest: PostgrestClient<any, any, any>;
  
  constructor(httpClient: HttpClient, tokenManager: TokenManager) {
    // Create postgrest client with custom fetch
    this.postgrest = new PostgrestClient<any, any, any>('http://dummy', {
      fetch: createInsForgePostgrestFetch(httpClient, tokenManager),
      headers: {}
    });
  }
  
  /**
   * Create a query builder for a table
   * 
   * @example
   * // Basic query
   * const { data, error } = await client.database
   *   .from('posts')
   *   .select('*')
   *   .eq('user_id', userId);
   * 
   * // With count (Supabase style!)
   * const { data, error, count } = await client.database
   *   .from('posts')
   *   .select('*', { count: 'exact' })
   *   .range(0, 9);
   * 
   * // Just get count, no data
   * const { count } = await client.database
   *   .from('posts')
   *   .select('*', { count: 'exact', head: true });
   * 
   * // Complex queries with OR
   * const { data } = await client.database
   *   .from('posts')
   *   .select('*, users!inner(*)')
   *   .or('status.eq.active,status.eq.pending');
   * 
   * // All features work:
   * - Nested selects
   * - Foreign key expansion  
   * - OR/AND/NOT conditions
   * - Count with head
   * - Range pagination
   * - Upserts
   */
  from(table: string) {
    // Return postgrest query builder with all features
    return this.postgrest.from(table);
  }

  /**
   * Call a PostgreSQL function (RPC)
   *
   * @example
   * // Call a function with parameters
   * const { data, error } = await client.database
   *   .rpc('get_user_stats', { user_id: 123 });
   *
   * // Call a function with no parameters
   * const { data, error } = await client.database
   *   .rpc('get_all_active_users');
   *
   * // With options (head, count, get)
   * const { data, count } = await client.database
   *   .rpc('search_posts', { query: 'hello' }, { count: 'exact' });
   */
  rpc(
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' }
  ) {
    return this.postgrest.rpc(fn, args, options);
  }
}