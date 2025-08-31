/**
 * Database module for InsForge SDK
 * Supabase-style query builder for PostgREST operations
 */

import { HttpClient } from '../lib/http-client';
import { InsForgeError } from '../types';

export interface DatabaseResponse<T> {
  data: T | null;
  error: InsForgeError | null;
  count?: number;
}

/**
 * Query builder for database operations
 * Uses method chaining like Supabase
 */
export class QueryBuilder<T = any> {
  private method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET';
  private headers: Record<string, string> = {};
  private queryParams: Record<string, string> = {};
  private body?: any;

  constructor(
    private table: string,
    private http: HttpClient
  ) {}

  /**
   * Perform a SELECT query
   * For mutations (insert/update/delete), this enables returning data
   * @param columns - Columns to select (default: '*')
   * @example
   * .select('*')
   * .select('id, title, content')
   * .insert({ title: 'New' }).select()  // Returns inserted data
   */
  select(columns: string = '*'): this {
    // For mutations, add return=representation header
    if (this.method !== 'GET') {
      const existingPrefer = this.headers['Prefer'] || '';
      const preferParts = existingPrefer ? [existingPrefer] : [];
      if (!preferParts.some(p => p.includes('return='))) {
        preferParts.push('return=representation');
      }
      this.headers['Prefer'] = preferParts.join(',');
    }
    
    if (columns !== '*') {
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
  insert(values: Partial<T> | Partial<T>[], options?: { upsert?: boolean }): this {
    this.method = 'POST';
    this.body = Array.isArray(values) ? values : [values];
    
    if (options?.upsert) {
      this.headers['Prefer'] = 'resolution=merge-duplicates';
    }
    
    return this;
  }

  /**
   * Perform an UPDATE
   * @param values - Object with fields to update
   * @example
   * .update({ title: 'Updated Title' }).select()
   */
  update(values: Partial<T>): this {
    this.method = 'PATCH';
    this.body = values;
    return this;
  }

  /**
   * Perform a DELETE
   * @example
   * .delete().select()
   */
  delete(): this {
    this.method = 'DELETE';
    return this;
  }

  /**
   * Perform an UPSERT
   * @param values - Single object or array of objects
   * @example
   * .upsert({ id: 1, title: 'Hello' })
   */
  upsert(values: Partial<T> | Partial<T>[]): this {
    return this.insert(values, { upsert: true });
  }

  // FILTERS

  /**
   * Filter by column equal to value
   * @example .eq('id', 123)
   */
  eq(column: string, value: any): this {
    this.queryParams[column] = `eq.${value}`;
    return this;
  }

  /**
   * Filter by column not equal to value
   * @example .neq('status', 'draft')
   */
  neq(column: string, value: any): this {
    this.queryParams[column] = `neq.${value}`;
    return this;
  }

  /**
   * Filter by column greater than value
   * @example .gt('age', 18)
   */
  gt(column: string, value: any): this {
    this.queryParams[column] = `gt.${value}`;
    return this;
  }

  /**
   * Filter by column greater than or equal to value
   * @example .gte('price', 100)
   */
  gte(column: string, value: any): this {
    this.queryParams[column] = `gte.${value}`;
    return this;
  }

  /**
   * Filter by column less than value
   * @example .lt('stock', 10)
   */
  lt(column: string, value: any): this {
    this.queryParams[column] = `lt.${value}`;
    return this;
  }

  /**
   * Filter by column less than or equal to value
   * @example .lte('discount', 50)
   */
  lte(column: string, value: any): this {
    this.queryParams[column] = `lte.${value}`;
    return this;
  }

  /**
   * Filter by pattern matching (case-sensitive)
   * @example .like('email', '%@gmail.com')
   */
  like(column: string, pattern: string): this {
    this.queryParams[column] = `like.${pattern}`;
    return this;
  }

  /**
   * Filter by pattern matching (case-insensitive)
   * @example .ilike('name', '%john%')
   */
  ilike(column: string, pattern: string): this {
    this.queryParams[column] = `ilike.${pattern}`;
    return this;
  }

  /**
   * Filter by checking if column is a value
   * @example .is('deleted_at', null)
   */
  is(column: string, value: null | boolean): this {
    if (value === null) {
      this.queryParams[column] = 'is.null';
    } else {
      this.queryParams[column] = `is.${value}`;
    }
    return this;
  }

  /**
   * Filter by checking if value is in array
   * @example .in('status', ['active', 'pending'])
   */
  in(column: string, values: any[]): this {
    this.queryParams[column] = `in.(${values.join(',')})`;
    return this;
  }

  // MODIFIERS

  /**
   * Order by column
   * @example 
   * .order('created_at')  // ascending
   * .order('created_at', { ascending: false })  // descending
   */
  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending !== false;
    this.queryParams.order = ascending ? column : `${column}.desc`;
    return this;
  }

  /**
   * Limit the number of rows returned
   * @example .limit(10)
   */
  limit(count: number): this {
    this.queryParams.limit = count.toString();
    return this;
  }

  /**
   * Return results from an offset
   * @example .offset(20)
   */
  offset(count: number): this {
    this.queryParams.offset = count.toString();
    return this;
  }

  /**
   * Set a range of rows to return
   * @example .range(0, 9)  // First 10 rows
   */
  range(from: number, to: number): this {
    this.headers['Range'] = `${from}-${to}`;
    return this;
  }

  /**
   * Return a single object instead of array
   * @example .single()
   */
  single(): this {
    this.headers['Accept'] = 'application/vnd.pgrst.object+json';
    return this;
  }

  /**
   * Get the total count (use with select)
   * @example .select('*', { count: 'exact' })
   */
  count(algorithm: 'exact' | 'planned' | 'estimated' = 'exact'): this {
    const prefer = this.headers['Prefer'] || '';
    this.headers['Prefer'] = prefer ? `${prefer},count=${algorithm}` : `count=${algorithm}`;
    return this;
  }

  /**
   * Execute the query and return results
   */
  async execute(): Promise<DatabaseResponse<T>> {
    try {
      const path = `/api/database/records/${this.table}`;
      let response: any;

      switch (this.method) {
        case 'GET':
          response = await this.http.get<T>(path, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
          
        case 'POST':
          response = await this.http.post<T>(path, this.body, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
          
        case 'PATCH':
          response = await this.http.patch<T>(path, this.body, {
            params: this.queryParams,
            headers: this.headers
          });
          break;
          
        case 'DELETE':
          response = await this.http.delete<T>(path, {
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
          'Database operation failed',
          500,
          'DATABASE_ERROR'
        )
      };
    }
  }

  /**
   * Make QueryBuilder thenable for async/await
   */
  then<TResult1 = DatabaseResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: DatabaseResponse<T>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/**
 * Database client for InsForge SDK
 * Provides Supabase-style interface
 */
export class Database {
  constructor(private http: HttpClient) {}

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
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, this.http);
  }
}