import { describe, it, expect, beforeAll } from 'vitest';
import { InsForgeClient } from '../client';
import { Database, QueryBuilder } from '../modules/database';

describe('InsForge SDK - Database Module', () => {
  let client: InsForgeClient;
  
  beforeAll(() => {
    client = new InsForgeClient({
      baseUrl: process.env.INSFORGE_BASE_URL || 'http://localhost:7130'
    });
  });

  describe('Query Builder Creation', () => {
    it('should create a query builder for a table', () => {
      const query = client.database.from('posts');
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should support generic types', () => {
      interface Post {
        id: string;
        title: string;
        content: string;
      }
      
      const query = client.database.from<Post>('posts');
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('SELECT Operations', () => {
    it('should build select query with default columns', () => {
      const query = client.database
        .from('posts')
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build select query with specific columns', () => {
      const query = client.database
        .from('posts')
        .select('id, title, created_at');
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build select with filters', () => {
      const query = client.database
        .from('posts')
        .select()
        .eq('user_id', '123')
        .gt('created_at', '2024-01-01');
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build select with ordering and pagination', () => {
      const query = client.database
        .from('posts')
        .select()
        .order('created_at', { ascending: false })
        .limit(10)
        .offset(20);
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('INSERT Operations', () => {
    it('should build insert query for single record', () => {
      const query = client.database
        .from('posts')
        .insert({ 
          title: 'Test Post',
          content: 'Test Content'
        })
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build insert query for multiple records', () => {
      const query = client.database
        .from('posts')
        .insert([
          { title: 'Post 1', content: 'Content 1' },
          { title: 'Post 2', content: 'Content 2' }
        ])
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build upsert query', () => {
      const query = client.database
        .from('posts')
        .upsert({ 
          id: '123',
          title: 'Updated or New Post'
        })
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('UPDATE Operations', () => {
    it('should build update query', () => {
      const query = client.database
        .from('posts')
        .update({ title: 'Updated Title' })
        .eq('id', '123')
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build update with multiple filters', () => {
      const query = client.database
        .from('posts')
        .update({ status: 'published' })
        .eq('user_id', '123')
        .is('deleted_at', null)
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('DELETE Operations', () => {
    it('should build delete query', () => {
      const query = client.database
        .from('posts')
        .delete()
        .eq('id', '123')
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should build delete with multiple filters', () => {
      const query = client.database
        .from('posts')
        .delete()
        .eq('user_id', '123')
        .lt('created_at', '2024-01-01')
        .select();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('Filter Methods', () => {
    it('should support all filter operators', () => {
      const query = client.database
        .from('posts')
        .select()
        .eq('id', '123')
        .neq('status', 'draft')
        .gt('views', 100)
        .gte('likes', 50)
        .lt('reports', 5)
        .lte('dislikes', 10)
        .like('title', '%test%')
        .ilike('content', '%search%')
        .is('deleted_at', null)
        .in('category', ['tech', 'news']);
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('Modifiers', () => {
    it('should support single() modifier', () => {
      const query = client.database
        .from('posts')
        .select()
        .eq('id', '123')
        .single();
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should support count() modifier', () => {
      const query = client.database
        .from('posts')
        .select()
        .count('exact');
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should support range() modifier', () => {
      const query = client.database
        .from('posts')
        .select()
        .range(0, 9);
      
      expect(query).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('Promise Interface', () => {
    it('should be thenable', async () => {
      const query = client.database
        .from('posts')
        .select()
        .limit(1);

      // Should be able to await directly
      expect(query.then).toBeDefined();
      expect(typeof query.then).toBe('function');
    });
  });

  describe('Error Handling', () => {
    it('should return error for invalid table', async () => {
      const { data, error } = await client.database
        .from('_invalid_table_name_')
        .select();
      
      expect(data).toBeNull();
      expect(error).toBeDefined();
    });
  });
});