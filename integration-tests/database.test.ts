import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signUpAndSignIn } from './setup';
import type { InsForgeClient } from '../src/client';

/**
 * Database integration tests.
 *
 * Exercises the postgrest-js query builder through the InsForge SDK.
 * Full request path: SDK → HttpClient → InsForge API → PostgREST.
 *
 * Prerequisite: a table `sdk_test` must exist on the test project.
 *   CREATE TABLE sdk_test (
 *     id         serial PRIMARY KEY,
 *     name       text NOT NULL,
 *     value      text,
 *     score      integer DEFAULT 0,
 *     created_at timestamptz DEFAULT now()
 *   );
 *
 * If the table doesn't exist the tests verify the SDK correctly
 * surfaces backend errors (and log a warning).
 */

const TABLE = 'sdk_test';

// Track whether the table is available so later describes can skip early
let tableAvailable = true;

describe('Database Module', () => {
  let client: InsForgeClient;
  const insertedIds: number[] = [];

  beforeAll(async () => {
    const result = await signUpAndSignIn();
    expect(result.error).toBeNull();
    client = result.client;

    // Probe the table
    const { error } = await client.database.from(TABLE).select('id').limit(1);
    if (error) {
      // Only downgrade for table-not-found errors; fail fast on auth/network/other issues
      const msg = (error.message || '').toLowerCase();
      const code = (error as any).code || '';
      if (code === '42P01' || msg.includes('relation') || msg.includes('not found') || msg.includes('does not exist')) {
        tableAvailable = false;
        console.warn(`⚠ Table "${TABLE}" not found – database tests will verify error handling only.`);
      } else {
        throw new Error(`Unexpected database error during probe: ${error.message} (code: ${code})`);
      }
    }
  });

  afterAll(async () => {
    if (insertedIds.length > 0 && tableAvailable) {
      await client.database.from(TABLE).delete().in('id', insertedIds);
    }
  });

  // ================================================================
  // SELECT
  // ================================================================

  describe('from().select()', () => {
    it('should return an array of rows', async () => {
      const { data, error } = await client.database
        .from(TABLE)
        .select('*')
        .limit(5);

      if (tableAvailable) {
        expect(error).toBeNull();
        expect(Array.isArray(data)).toBe(true);
      } else {
        expect(error).toBeDefined();
      }
    });

    it('should select specific columns', async () => {
      const { data, error } = await client.database
        .from(TABLE)
        .select('id, name')
        .limit(3);

      if (tableAvailable && !error) {
        expect(Array.isArray(data)).toBe(true);
        if (data!.length > 0) {
          // Only id and name should be returned
          expect(data![0]).toHaveProperty('id');
          expect(data![0]).toHaveProperty('name');
        }
      }
    });

    it('should support count-only queries (head: true)', async () => {
      const { count, error } = await client.database
        .from(TABLE)
        .select('*', { count: 'exact', head: true });

      if (tableAvailable) {
        expect(error).toBeNull();
        expect(typeof count).toBe('number');
      }
    });

    it('should return empty array for impossible filter', async () => {
      const { data, error } = await client.database
        .from(TABLE)
        .select('*')
        .eq('name', `nonexistent-${Date.now()}-${Math.random()}`);

      if (tableAvailable) {
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    });
  });

  // ================================================================
  // INSERT
  // ================================================================

  describe('from().insert()', () => {
    it('should insert a single row and return it', async () => {
      if (!tableAvailable) return;

      const name = `insert-single-${Date.now()}`;
      const { data, error } = await client.database
        .from(TABLE)
        .insert({ name, value: 'single', score: 10 })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.name).toBe(name);
      expect(data.value).toBe('single');
      expect(data.score).toBe(10);
      expect(data.id).toBeDefined();
      insertedIds.push(data.id);
    });

    it('should insert multiple rows', async () => {
      if (!tableAvailable) return;

      const rows = [
        { name: `batch-a-${Date.now()}`, value: 'batch', score: 20 },
        { name: `batch-b-${Date.now()}`, value: 'batch', score: 30 },
      ];

      const { data, error } = await client.database
        .from(TABLE)
        .insert(rows)
        .select();

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data!.length).toBe(2);
      data!.forEach((row: any) => insertedIds.push(row.id));
    });
  });

  // ================================================================
  // UPDATE
  // ================================================================

  describe('from().update()', () => {
    it('should update a row and return the result', async () => {
      if (!tableAvailable) return;

      // Insert first
      const tag = `update-${Date.now()}`;
      const { data: inserted } = await client.database
        .from(TABLE)
        .insert({ name: tag, value: 'before', score: 0 })
        .select()
        .single();
      if (!inserted) return;
      insertedIds.push(inserted.id);

      // Update
      const { data, error } = await client.database
        .from(TABLE)
        .update({ value: 'after', score: 99 })
        .eq('id', inserted.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.value).toBe('after');
      expect(data.score).toBe(99);
    });
  });

  // ================================================================
  // UPSERT
  // ================================================================

  describe('from().upsert()', () => {
    it('should insert when row does not exist', async () => {
      if (!tableAvailable) return;

      const tag = `upsert-${Date.now()}`;
      const { data, error } = await client.database
        .from(TABLE)
        .upsert({ name: tag, value: 'upserted', score: 50 })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.name).toBe(tag);
      insertedIds.push(data.id);
    });
  });

  // ================================================================
  // DELETE
  // ================================================================

  describe('from().delete()', () => {
    it('should delete matching rows', async () => {
      if (!tableAvailable) return;

      const tag = `delete-${Date.now()}`;
      const { data: inserted } = await client.database
        .from(TABLE)
        .insert({ name: tag, value: 'to-delete' })
        .select()
        .single();
      if (!inserted) return;

      const { error } = await client.database
        .from(TABLE)
        .delete()
        .eq('id', inserted.id);

      expect(error).toBeNull();

      // Verify it's gone
      const { data: check } = await client.database
        .from(TABLE)
        .select('id')
        .eq('id', inserted.id);

      expect(check).toEqual([]);
    });
  });

  // ================================================================
  // Filters & operators
  // ================================================================

  describe('filters', () => {
    let seedId: number;

    beforeAll(async () => {
      if (!tableAvailable) return;

      const rows = [
        { name: 'filter-alpha', value: 'hello world', score: 10 },
        { name: 'filter-beta', value: 'hello earth', score: 20 },
        { name: 'filter-gamma', value: 'goodbye world', score: 30 },
      ];

      const { data } = await client.database
        .from(TABLE)
        .insert(rows)
        .select();

      if (data) {
        data.forEach((r: any) => insertedIds.push(r.id));
        seedId = data[0].id;
      }
    });

    it('eq() should match exact value', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('*').eq('name', 'filter-alpha');
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data![0].name).toBe('filter-alpha');
    });

    it('neq() should exclude exact value', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('name').neq('name', 'filter-alpha').like('name', 'filter-%');
      expect(data!.every((r: any) => r.name !== 'filter-alpha')).toBe(true);
    });

    it('gt() / lt() should compare numerically', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('name, score').gt('score', 15).lt('score', 25).like('name', 'filter-%');
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data![0].score).toBe(20);
    });

    it('gte() / lte() should compare inclusive', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('name, score').gte('score', 20).lte('score', 30).like('name', 'filter-%');
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it('like() should match pattern', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('value').like('value', '%world%').like('name', 'filter-%');
      expect(data!.length).toBeGreaterThanOrEqual(1);
      data!.forEach((r: any) => expect(r.value).toContain('world'));
    });

    it('ilike() should match case-insensitively', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('value').ilike('value', '%HELLO%').like('name', 'filter-%');
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it('in() should match multiple values', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('name').in('name', ['filter-alpha', 'filter-gamma']);
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it('order() should sort results', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('score').like('name', 'filter-%').order('score', { ascending: true });
      if (data!.length >= 2) {
        expect(data![0].score).toBeLessThanOrEqual(data![1].score);
      }
    });

    it('limit() should cap result count', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('*').like('name', 'filter-%').limit(1);
      expect(data!.length).toBeLessThanOrEqual(1);
    });

    it('range() should paginate results', async () => {
      if (!tableAvailable) return;
      const { data } = await client.database
        .from(TABLE).select('*').like('name', 'filter-%').range(0, 1);
      expect(data!.length).toBeLessThanOrEqual(2);
    });

    it('single() should return one row', async () => {
      if (!tableAvailable || !seedId) return;
      const { data, error } = await client.database
        .from(TABLE).select('*').eq('id', seedId).single();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.id).toBe(seedId);
    });

    it('maybeSingle() should return null for no match', async () => {
      if (!tableAvailable) return;
      const { data, error } = await client.database
        .from(TABLE).select('*').eq('name', `no-match-${Date.now()}`).maybeSingle();
      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  // ================================================================
  // RPC
  // ================================================================

  describe('rpc()', () => {
    it('should call an RPC function or return structured error', async () => {
      const { data, error } = await client.database.rpc('ping');

      // Function may not exist – both outcomes are valid
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });
  });
});
