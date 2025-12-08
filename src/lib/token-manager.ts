/**
 * Token Manager for InsForge SDK
 * 
 * A thin wrapper that delegates to the underlying SessionStorageStrategy.
 * This class maintains backward compatibility while using the Strategy Pattern internally.
 */

import type { UserSchema } from '@insforge/shared-schemas';
import type { AuthSession, TokenStorage } from '../types';
import {
  SessionStorageStrategy,
  PersistentSessionStorage,
} from './session-storage';

/**
 * TokenManager - Manages session storage using the Strategy Pattern
 * 
 * The actual storage implementation is delegated to a SessionStorageStrategy.
 * By default, uses PersistentSessionStorage until a strategy is explicitly set
 * via setStrategy() during client initialization.
 */
export class TokenManager {
  private strategy: SessionStorageStrategy;

  /**
   * Create a new TokenManager
   * @param storage - Optional custom storage adapter (used for initial PersistentSessionStorage)
   */
  constructor(storage?: TokenStorage) {
    // Default to persistent storage until capability discovery completes
    this.strategy = new PersistentSessionStorage(storage);
  }

  /**
   * Set the storage strategy
   * Called after capability discovery to switch to the appropriate strategy
   */
  setStrategy(strategy: SessionStorageStrategy): void {
    // Migrate existing session data if switching strategies
    const existingSession = this.strategy.getSession();
    const previousId = this.strategy.strategyId;
    
    this.strategy = strategy;
    
    // If we had a session and are switching to a different strategy, migrate it
    if (existingSession && previousId !== strategy.strategyId) {
      strategy.saveSession(existingSession);
    }
  }

  /**
   * Get the current strategy identifier
   */
  getStrategyId(): string {
    return this.strategy.strategyId;
  }

  // --- Delegated Methods ---

  /**
   * Save session data
   */
  saveSession(session: AuthSession): void {
    this.strategy.saveSession(session);
  }

  /**
   * Get current session
   */
  getSession(): AuthSession | null {
    return this.strategy.getSession();
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return this.strategy.getAccessToken();
  }

  /**
   * Update access token (e.g., after refresh)
   */
  setAccessToken(token: string): void {
    this.strategy.setAccessToken(token);
  }

  /**
   * Get user data
   */
  getUser(): UserSchema | null {
    return this.strategy.getUser();
  }

  /**
   * Update user data
   */
  setUser(user: UserSchema): void {
    this.strategy.setUser(user);
  }

  /**
   * Clear all session data
   */
  clearSession(): void {
    this.strategy.clearSession();
  }

  /**
   * Check if token refresh should be attempted
   * (e.g., on page reload in secure mode)
   */
  shouldAttemptRefresh(): boolean {
    return this.strategy.shouldAttemptRefresh();
  }
}
