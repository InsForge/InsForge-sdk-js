/**
 * Storage module for InsForge SDK
 * Handles file uploads, downloads, and bucket management
 */

import { HttpClient } from '../lib/http-client';
import { InsForgeError } from '../types';
import type { 
  StorageFileSchema,
  ListObjectsResponseSchema
} from '@insforge/shared-schemas';

export interface StorageResponse<T> {
  data: T | null;
  error: InsForgeError | null;
}

/**
 * Storage bucket operations
 */
export class StorageBucket {
  constructor(
    private bucketName: string,
    private http: HttpClient
  ) {}

  /**
   * Upload a file with a specific key
   * @param path - The object key/path
   * @param file - File or Blob to upload
   */
  async upload(
    path: string,
    file: File | Blob
  ): Promise<StorageResponse<StorageFileSchema>> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use PUT for specific path
      const response = await this.http.request<StorageFileSchema>(
        'PUT',
        `/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`,
        {
          body: formData as any,
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
          'Upload failed',
          500,
          'STORAGE_ERROR'
        )
      };
    }
  }

  /**
   * Upload a file with auto-generated key
   * @param file - File or Blob to upload
   */
  async uploadAuto(
    file: File | Blob
  ): Promise<StorageResponse<StorageFileSchema>> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use POST for auto-generated key
      const response = await this.http.request<StorageFileSchema>(
        'POST',
        `/api/storage/buckets/${this.bucketName}/objects`,
        {
          body: formData as any,
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
          'Upload failed',
          500,
          'STORAGE_ERROR'
        )
      };
    }
  }

  /**
   * Download a file
   * @param path - The object key/path
   * Returns the file as a Blob
   */
  async download(path: string): Promise<{ data: Blob | null; error: InsForgeError | null }> {
    try {
      // For binary data, we need to use fetch directly with proper response handling
      // The http.request method expects JSON responses, so we can't use it for blobs
      const url = `${this.http.baseUrl}/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`;
      
      const response = await this.http.fetch(url, {
        method: 'GET',
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
            'STORAGE_ERROR'
          );
        }
      }

      const blob = await response.blob();
      return { data: blob, error: null };
    } catch (error) {
      return { 
        data: null, 
        error: error instanceof InsForgeError ? error : new InsForgeError(
          'Download failed',
          500,
          'STORAGE_ERROR'
        )
      };
    }
  }

  /**
   * Get public URL for a file
   * @param path - The object key/path
   */
  getPublicUrl(path: string): string {
    return `${this.http.baseUrl}/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`;
  }

  /**
   * List objects in the bucket
   * @param prefix - Filter by key prefix
   * @param search - Search in file names
   * @param limit - Maximum number of results (default: 100, max: 1000)
   * @param offset - Number of results to skip
   */
  async list(options?: {
    prefix?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<StorageResponse<ListObjectsResponseSchema>> {
    try {
      const params: Record<string, string> = {};
      
      if (options?.prefix) params.prefix = options.prefix;
      if (options?.search) params.search = options.search;
      if (options?.limit) params.limit = options.limit.toString();
      if (options?.offset) params.offset = options.offset.toString();

      const response = await this.http.get<ListObjectsResponseSchema>(
        `/api/storage/buckets/${this.bucketName}/objects`,
        { params }
      );

      return { data: response, error: null };
    } catch (error) {
      return { 
        data: null, 
        error: error instanceof InsForgeError ? error : new InsForgeError(
          'List failed',
          500,
          'STORAGE_ERROR'
        )
      };
    }
  }

  /**
   * Delete a file
   * @param path - The object key/path
   */
  async remove(path: string): Promise<StorageResponse<{ message: string }>> {
    try {
      const response = await this.http.delete<{ message: string }>(
        `/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}`
      );

      return { data: response, error: null };
    } catch (error) {
      return { 
        data: null, 
        error: error instanceof InsForgeError ? error : new InsForgeError(
          'Delete failed',
          500,
          'STORAGE_ERROR'
        )
      };
    }
  }
}

/**
 * Storage module for file operations
 */
export class Storage {
  constructor(private http: HttpClient) {}

  /**
   * Get a bucket instance for operations
   * @param bucketName - Name of the bucket
   */
  from(bucketName: string): StorageBucket {
    return new StorageBucket(bucketName, this.http);
  }
}