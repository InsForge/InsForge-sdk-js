import { describe, expect, it, vi } from 'vitest';
import { TokenManager } from '../token-manager';

describe('TokenManager auth-state listeners', () => {
  it('isolates a throwing listener so later listeners and callers continue', () => {
    const tokenManager = new TokenManager();
    const secondListener = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    tokenManager.onAuthStateChange(() => {
      throw new Error('listener failed');
    });
    tokenManager.onAuthStateChange(secondListener);

    expect(() => tokenManager.setAccessToken('token')).not.toThrow();
    expect(secondListener).toHaveBeenCalledWith('signedIn');
    expect(errorSpy).toHaveBeenCalled();
  });
});
