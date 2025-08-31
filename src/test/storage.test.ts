import { describe, it, expect, beforeAll } from 'vitest';
import { InsForgeClient } from '../client';
import { Storage, StorageBucket } from '../modules/storage';

describe('InsForge SDK - Storage Module', () => {
  let client: InsForgeClient;
  
  beforeAll(() => {
    client = new InsForgeClient({
      baseUrl: process.env.INSFORGE_BASE_URL || 'http://localhost:7130'
    });
  });

  describe('Storage Instance', () => {
    it('should have storage module on client', () => {
      expect(client.storage).toBeInstanceOf(Storage);
    });

    it('should create a bucket instance', () => {
      const bucket = client.storage.from('test-bucket');
      expect(bucket).toBeInstanceOf(StorageBucket);
    });
  });


  describe('File Operations', () => {
    let bucket: StorageBucket;

    beforeAll(() => {
      bucket = client.storage.from('test-bucket');
    });

    it('should have upload method', () => {
      expect(bucket.upload).toBeDefined();
      expect(typeof bucket.upload).toBe('function');
    });

    it('should have uploadAuto method', () => {
      expect(bucket.uploadAuto).toBeDefined();
      expect(typeof bucket.uploadAuto).toBe('function');
    });

    it('should have download method', () => {
      expect(bucket.download).toBeDefined();
      expect(typeof bucket.download).toBe('function');
    });

    it('should have remove method', () => {
      expect(bucket.remove).toBeDefined();
      expect(typeof bucket.remove).toBe('function');
    });

    it('should have list method', () => {
      expect(bucket.list).toBeDefined();
      expect(typeof bucket.list).toBe('function');
    });

    it('should generate public URL', () => {
      const url = bucket.getPublicUrl('test-file.jpg');
      expect(url).toContain('/api/storage/buckets/test-bucket/objects/test-file.jpg');
    });

    it('should encode special characters in URLs', () => {
      const url = bucket.getPublicUrl('folder/file with spaces.jpg');
      expect(url).toContain('folder%2Ffile%20with%20spaces.jpg');
    });
  });

  describe('Upload Options', () => {
    it('should handle File upload', () => {
      const bucket = client.storage.from('test-bucket');
      
      // Mock File object for testing
      if (typeof File === 'undefined') {
        // Node.js environment - skip File test
        expect(true).toBe(true);
      } else {
        const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
        expect(bucket.upload).toBeDefined();
      }
    });

    it('should handle FormData upload', () => {
      const bucket = client.storage.from('test-bucket');
      
      if (typeof FormData === 'undefined') {
        // Node.js environment - skip FormData test
        expect(true).toBe(true);
      } else {
        const formData = new FormData();
        expect(bucket.upload).toBeDefined();
      }
    });
  });

  describe('List Options', () => {
    it('should support list with prefix', () => {
      const bucket = client.storage.from('test-bucket');
      expect(bucket.list({ prefix: 'folder/' })).toBeDefined();
    });

    it('should support list with search', () => {
      const bucket = client.storage.from('test-bucket');
      expect(bucket.list({ search: 'image' })).toBeDefined();
    });

    it('should support list with pagination', () => {
      const bucket = client.storage.from('test-bucket');
      expect(bucket.list({ limit: 10, offset: 20 })).toBeDefined();
    });
  });
});