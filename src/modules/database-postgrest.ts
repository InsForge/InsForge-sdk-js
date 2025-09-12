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
    
    // Extract table name from pathname
    // postgrest-js sends: http://dummy/tablename?params
    // We need: http://localhost:7130/api/database/records/tablename?params
    const tableName = urlObj.pathname.slice(1); // Remove leading /
    
    // Build InsForge URL
    const insforgeUrl = `${httpClient.baseUrl}/api/database/records/${tableName}${urlObj.search}`;
    
    // Get auth token from TokenManager
    const token = tokenManager.getAccessToken();
    
    // Prepare headers
    const headers = new Headers(init?.headers);
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    // Make the actual request using native fetch
    const response = await fetch(insforgeUrl, {
      ...init,
      headers
    });
    
    // RESPONSE TRANSFORMATION FOR POSTGREST-JS COMPATIBILITY
    // 
    // Backend returns (wrapped):
    // {
    //   data: [{id: 1}, {id: 2}],        // The actual rows
    //   pagination: {                     // Pagination metadata
    //     offset: 0,
    //     limit: 10,
    //     total: 100
    //   }
    // }
    // Headers: Content-Range: 0-9/100
    //
    // PostgREST-js expects (unwrapped):
    // [{id: 1}, {id: 2}]                  // Just the array
    // Headers: Content-Range: 0-9/100     // Pagination in header
    //
    // We unwrap only for GET requests (SELECT queries)
    if (response.ok && (!init?.method || init.method === 'GET')) {
      try {
        // Clone to read body without consuming original
        const body = await response.clone().json();
        
        // Check if backend wrapped the response
        if (body?.data && body?.pagination) {
          return new Response(
            JSON.stringify(body.data),
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            }
          );
        }
      } catch {
        // Not JSON or parsing failed, return original
        // This handles non-JSON responses, errors, etc.
      }
    }
    
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
}