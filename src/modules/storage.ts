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

interface UploadStrategy {
  method: 'direct' | 'presigned';
  uploadUrl: string;
  fields?: Record<string, string>;
  key: string;
  confirmRequired: boolean;
  confirmUrl?: string;
  expiresAt?: Date;
}

interface DownloadStrategy {
  method: 'direct' | 'presigned';
  url: string;
  expiresAt?: Date;
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
   * Uses the upload strategy from backend (direct or presigned)
   * @param path - The object key/path
   * @param file - File or Blob to upload
   */
  async upload(
    path: string,
    file: File | Blob
  ): Promise<StorageResponse<StorageFileSchema>> {
    try {
      // Get upload strategy from backend - this is required
      const strategyResponse = await this.http.post<UploadStrategy>(
        `/api/storage/buckets/${this.bucketName}/upload-strategy`,
        {
          filename: path,
          contentType: file.type || 'application/octet-stream',
          size: file.size
        }
      );

      // Use presigned URL if available
      if (strategyResponse.method === 'presigned') {
        return await this.uploadWithPresignedUrl(strategyResponse, file);
      }

      // Use direct upload if strategy says so
      if (strategyResponse.method === 'direct') {
        const formData = new FormData();
        formData.append('file', file);

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
      }

      throw new InsForgeError(
        `Unsupported upload method: ${strategyResponse.method}`,
        500,
        'STORAGE_ERROR'
      );
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
   * Uses the upload strategy from backend (direct or presigned)
   * @param file - File or Blob to upload
   */
  async uploadAuto(
    file: File | Blob
  ): Promise<StorageResponse<StorageFileSchema>> {
    try {
      const filename = file instanceof File ? file.name : 'file';
      
      // Get upload strategy from backend - this is required
      const strategyResponse = await this.http.post<UploadStrategy>(
        `/api/storage/buckets/${this.bucketName}/upload-strategy`,
        {
          filename,
          contentType: file.type || 'application/octet-stream',
          size: file.size
        }
      );

      // Use presigned URL if available
      if (strategyResponse.method === 'presigned') {
        return await this.uploadWithPresignedUrl(strategyResponse, file);
      }

      // Use direct upload if strategy says so
      if (strategyResponse.method === 'direct') {
        const formData = new FormData();
        formData.append('file', file);

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
      }

      throw new InsForgeError(
        `Unsupported upload method: ${strategyResponse.method}`,
        500,
        'STORAGE_ERROR'
      );
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
   * Internal method to handle presigned URL uploads
   */
  private async uploadWithPresignedUrl(
    strategy: UploadStrategy,
    file: File | Blob
  ): Promise<StorageResponse<StorageFileSchema>> {
    try {
      // Upload to presigned URL (e.g., S3)
      const formData = new FormData();
      
      // Add all fields from the presigned URL
      if (strategy.fields) {
        Object.entries(strategy.fields).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }
      
      // File must be the last field for S3
      formData.append('file', file);

      const uploadResponse = await fetch(strategy.uploadUrl, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new InsForgeError(
          `Upload to storage failed: ${uploadResponse.statusText}`,
          uploadResponse.status,
          'STORAGE_ERROR'
        );
      }

      // Confirm upload with backend if required
      if (strategy.confirmRequired && strategy.confirmUrl) {
        const confirmResponse = await this.http.post<StorageFileSchema>(
          strategy.confirmUrl,
          {
            size: file.size,
            contentType: file.type || 'application/octet-stream'
          }
        );

        return { data: confirmResponse, error: null };
      }

      // If no confirmation required, return basic file info
      return {
        data: {
          key: strategy.key,
          bucket: this.bucketName,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
          url: this.getPublicUrl(strategy.key)
        } as StorageFileSchema,
        error: null
      };
    } catch (error) {
      throw error instanceof InsForgeError ? error : new InsForgeError(
        'Presigned upload failed',
        500,
        'STORAGE_ERROR'
      );
    }
  }

  /**
   * Download a file
   * Uses the download strategy from backend (direct or presigned)
   * @param path - The object key/path
   * Returns the file as a Blob
   */
  async download(path: string): Promise<{ data: Blob | null; error: InsForgeError | null }> {
    try {
      // Get download strategy from backend - this is required
      const strategyResponse = await this.http.post<DownloadStrategy>(
        `/api/storage/buckets/${this.bucketName}/objects/${encodeURIComponent(path)}/download-strategy`,
        { expiresIn: 3600 }
      );

      // Use URL from strategy
      const downloadUrl = strategyResponse.url;
      
      // Download from the URL
      const headers: HeadersInit = {};
      
      // Only add auth header for direct downloads (not presigned URLs)
      if (strategyResponse.method === 'direct') {
        Object.assign(headers, this.http.getHeaders());
      }
      
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers
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