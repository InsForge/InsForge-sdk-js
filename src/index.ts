/**
 * @insforge/sdk - TypeScript SDK for InsForge Backend-as-a-Service
 * 
 * @packageDocumentation
 */

// Main client
export { InsForgeClient } from './client';

// Types
export type {
  InsForgeConfig,
  InsForgeConfig as ClientOptions,  // Alias for compatibility
  TokenStorage,
  AuthSession,
  ApiError,
} from './types';

export { InsForgeError } from './types';

// Re-export shared schemas that SDK users will need
export type {
  UserSchema,
  CreateUserRequest,
  CreateSessionRequest,
  AuthErrorResponse,
} from '@insforge/shared-schemas';

// Re-export auth module for advanced usage
export { Auth } from './modules/auth';

// Re-export database module (using postgrest-js)
export { Database } from './modules/database-postgrest';
// Note: QueryBuilder is no longer exported as we use postgrest-js QueryBuilder internally

// Re-export storage module and types
export { Storage, StorageBucket } from './modules/storage';
export type { StorageResponse } from './modules/storage';

// Re-export AI module
export { AI } from './modules/ai';

// Re-export Functions module
export { Functions } from './modules/functions';
export type { FunctionInvokeOptions } from './modules/functions';

// Re-export Emails module (Resend-compatible API)
export { Emails } from './modules/email';
export type { SendEmailOptions, SendEmailResponse } from './modules/email';

// Re-export Realtime module and types
export { Realtime } from './modules/realtime';
export type {
  RealtimeErrorPayload,
  SubscribeResponse,
  SocketMessage,
  ConnectionState,
  EventCallback,
} from './modules/realtime';

// Re-export utilities for advanced usage
export { HttpClient } from './lib/http-client';
export { TokenManager } from './lib/token-manager';

// Re-export session storage strategies for advanced usage
export {
  SecureSessionStorage,
  LocalSessionStorage,
} from './lib/session-storage';
export type { SessionStorageStrategy } from './lib/session-storage';

// Factory function for creating clients (Supabase-style)
import { InsForgeClient } from './client';
import { InsForgeConfig } from './types';

export function createClient(config: InsForgeConfig): InsForgeClient {
  return new InsForgeClient(config);
}

// Default export for convenience
export default InsForgeClient;
