import { TokenStorage, AuthSession } from '../types';

const TOKEN_KEY = 'insforge-auth-token';
const USER_KEY = 'insforge-auth-user';

export class TokenManager {
  private storage: TokenStorage;

  constructor(storage?: TokenStorage) {
    if (storage) {
      // Use provided storage
      this.storage = storage;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      // Browser: use localStorage
      this.storage = window.localStorage;
    } else {
      // Node.js: use in-memory storage
      const store = new Map<string, string>();
      this.storage = {
        getItem: (key: string) => store.get(key) || null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); }
      };
    }
  }

  saveSession(session: AuthSession): void {
    this.storage.setItem(TOKEN_KEY, session.accessToken);
    this.storage.setItem(USER_KEY, JSON.stringify(session.user));
  }

  getSession(): AuthSession | null {
    const token = this.storage.getItem(TOKEN_KEY);
    const userStr = this.storage.getItem(USER_KEY);

    if (!token || !userStr) {
      return null;
    }

    try {
      const user = JSON.parse(userStr as string);
      return { accessToken: token as string, user };
    } catch {
      this.clearSession();
      return null;
    }
  }

  getAccessToken(): string | null {
    const token = this.storage.getItem(TOKEN_KEY);
    return typeof token === 'string' ? token : null;
  }

  clearSession(): void {
    this.storage.removeItem(TOKEN_KEY);
    this.storage.removeItem(USER_KEY);
  }
}