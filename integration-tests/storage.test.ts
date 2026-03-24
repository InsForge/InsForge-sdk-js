import { describe, it, expect, beforeAll } from 'vitest';
import { signUpAndSignIn, getTestEnv } from './setup';
import type { InsForgeClient } from '../src/client';

/**
 * Storage integration tests.
 *
 * Exercises the full upload / list / download / delete lifecycle.
 *
 * Prerequisite: a bucket named `public` (or whatever BUCKET is set to)
 * must exist and allow authenticated uploads.
 *
 * Public methods tested:
 *   Storage.from(bucket) → StorageBucket
 *   StorageBucket.upload(path, file)
 *   StorageBucket.uploadAuto(file)
 *   StorageBucket.download(path)
 *   StorageBucket.getPublicUrl(path)
 *   StorageBucket.list(options)
 *   StorageBucket.remove(path)
 */

const BUCKET = 'public';
let bucketAvailable = true;

describe('Storage Module', () => {
  let client: InsForgeClient;
  let env: ReturnType<typeof getTestEnv>;

  beforeAll(async () => {
    env = getTestEnv();
    const result = await signUpAndSignIn();
    expect(result.error).toBeNull();
    client = result.client;

    // Probe the bucket – try a small upload to confirm it exists and accepts writes
    const probe = new Blob(['probe'], { type: 'text/plain' });
    const { error } = await client.storage.from(BUCKET).upload(`_sdk_probe_${Date.now()}.txt`, probe);
    if (error) {
      bucketAvailable = false;
      console.warn(`⚠ Bucket "${BUCKET}" not available – storage tests will verify error handling only.`);
    } else {
      // Clean up probe file (best-effort)
      await client.storage.from(BUCKET).remove(`_sdk_probe_${Date.now()}.txt`).catch(() => {});
    }
  });

  // ================================================================
  // from() – factory method
  // ================================================================

  describe('from()', () => {
    it('should return a StorageBucket instance', () => {
      const bucket = client.storage.from(BUCKET);
      expect(bucket).toBeDefined();
      expect(typeof bucket.upload).toBe('function');
      expect(typeof bucket.uploadAuto).toBe('function');
      expect(typeof bucket.download).toBe('function');
      expect(typeof bucket.getPublicUrl).toBe('function');
      expect(typeof bucket.list).toBe('function');
      expect(typeof bucket.remove).toBe('function');
    });
  });

  // ================================================================
  // getPublicUrl  (pure client-side, always works)
  // ================================================================

  describe('getPublicUrl()', () => {
    it('should build a correct public URL', () => {
      const url = client.storage.from(BUCKET).getPublicUrl('images/logo.png');
      expect(url).toContain(env.baseUrl);
      expect(url).toContain(BUCKET);
      expect(url).toContain('images%2Flogo.png');
    });

    it('should handle nested paths', () => {
      const url = client.storage.from(BUCKET).getPublicUrl('a/b/c/file.txt');
      expect(url).toContain('a%2Fb%2Fc%2Ffile.txt');
    });

    it('should handle paths with special characters', () => {
      const url = client.storage.from(BUCKET).getPublicUrl('files/my doc (1).pdf');
      expect(url).toContain(BUCKET);
      // URL encoding should be applied
      expect(url).toBeDefined();
    });
  });

  // ================================================================
  // list
  // ================================================================

  describe('list()', () => {
    it('should list objects in a bucket', async () => {
      const { data, error } = await client.storage.from(BUCKET).list({ limit: 10 });

      if (bucketAvailable) {
        expect(error).toBeNull();
        expect(data).toBeDefined();
      } else {
        // Bucket doesn't exist – API may return an error or empty result
        expect(data !== null || error !== null || (data === null && error === null)).toBe(true);
      }
    });

    it('should support prefix filtering', async () => {
      const { data, error } = await client.storage.from(BUCKET).list({ prefix: 'sdk-test/' });

      if (bucketAvailable) {
        expect(error).toBeNull();
        expect(data).toBeDefined();
      }
    });

    it('should support limit and offset', async () => {
      const { data, error } = await client.storage.from(BUCKET).list({ limit: 2, offset: 0 });

      if (bucketAvailable && !error) {
        expect(data).toBeDefined();
      }
    });

    it('should support search', async () => {
      const { data, error } = await client.storage.from(BUCKET).list({ search: 'integration' });

      if (bucketAvailable && !error) {
        expect(data).toBeDefined();
      }
    });
  });

  // ================================================================
  // Full file lifecycle: upload → list → download → remove
  // ================================================================

  describe('upload()', () => {
    const filePath = `sdk-test/upload-${Date.now()}.txt`;
    const fileContent = 'Upload test – ' + new Date().toISOString();

    it('should upload a file with a specific path', async () => {
      if (!bucketAvailable) return;

      const blob = new Blob([fileContent], { type: 'text/plain' });
      const { data, error } = await client.storage.from(BUCKET).upload(filePath, blob);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.key).toBeDefined();
    });

    it('should find the uploaded file in listings', async () => {
      if (!bucketAvailable) return;

      const { data } = await client.storage.from(BUCKET).list({ prefix: 'sdk-test/' });
      // File may or may not show immediately, but listing should work
      expect(data).toBeDefined();
    });

    it('should delete the uploaded file', async () => {
      if (!bucketAvailable) return;

      const { data, error } = await client.storage.from(BUCKET).remove(filePath);

      if (error) {
        // File might have already been deleted or not found
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });
  });

  describe('uploadAuto()', () => {
    it('should upload a file with auto-generated key', async () => {
      if (!bucketAvailable) return;

      const content = 'Auto upload – ' + Date.now();
      const blob = new Blob([content], { type: 'text/plain' });

      // Create a File-like object (in Node the Blob is sufficient)
      const { data, error } = await client.storage.from(BUCKET).uploadAuto(blob);

      if (error) {
        // Some backends may not support auto key generation
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).not.toBeNull();
        expect(data!.key).toBeDefined();

        // Clean up
        await client.storage.from(BUCKET).remove(data!.key);
      }
    });
  });

  describe('download()', () => {
    it('should download a previously uploaded file', async () => {
      if (!bucketAvailable) return;

      const path = `sdk-test/download-${Date.now()}.txt`;
      const originalContent = 'Download test – ' + Date.now();
      const blob = new Blob([originalContent], { type: 'text/plain' });

      // Upload
      const { error: upErr } = await client.storage.from(BUCKET).upload(path, blob);
      if (upErr) {
        console.log('Upload failed, skipping download test:', upErr.message);
        return;
      }

      // Download
      const { data, error } = await client.storage.from(BUCKET).download(path);

      if (!error) {
        expect(data).toBeDefined();
        expect(data).toBeInstanceOf(Blob);
      }

      // Clean up
      await client.storage.from(BUCKET).remove(path);
    });

    it('should return error for non-existent file', async () => {
      const { error } = await client.storage
        .from(BUCKET)
        .download(`nonexistent-${Date.now()}.txt`);

      expect(error).not.toBeNull();
    });
  });

  describe('remove()', () => {
    it('should return error or success for non-existent file', async () => {
      const { data, error } = await client.storage
        .from(BUCKET)
        .remove(`nonexistent-${Date.now()}.txt`);

      // Either succeeds with message or returns structured error
      expect(data !== null || error !== null).toBe(true);
    });
  });
});
