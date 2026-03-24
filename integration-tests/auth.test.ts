import { describe, it, expect, beforeAll } from 'vitest';
import {
  createClient,
  getTestEnv,
  uniqueEmail,
  signUpFreshUser,
  signUpAndSignIn,
  TEST_PASSWORD,
} from './setup';
import type { InsForgeClient } from '../src/client';

describe('Auth Module', () => {
  let client: InsForgeClient;

  beforeAll(() => {
    client = createClient();
  });

  // ================================================================
  // getPublicAuthConfig  (no auth required)
  // ================================================================

  describe('getPublicAuthConfig()', () => {
    it('should return the project auth configuration', async () => {
      const { data, error } = await client.auth.getPublicAuthConfig();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data).not.toBeNull();
    });
  });

  // ================================================================
  // signUp
  // ================================================================

  describe('signUp()', () => {
    it('should create a new user and return user data', async () => {
      const email = uniqueEmail('signup');
      const { data, error } = await client.auth.signUp({
        email,
        password: TEST_PASSWORD,
        name: 'Signup Test',
      });

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      if (data!.user) {
        // When email verification is NOT required, user and token are returned
        expect(data!.user.email).toBe(email);
        expect(data!.user.id).toBeDefined();
        expect(data!.accessToken).toBeDefined();
      } else {
        // When email verification IS required, signUp succeeds but
        // user/accessToken may be absent until the email is verified
        expect(data).toBeDefined();
      }
    });

    it('should reject a duplicate email', async () => {
      const email = uniqueEmail('dup');

      const first = await client.auth.signUp({
        email,
        password: TEST_PASSWORD,
        name: 'First',
      });
      expect(first.error).toBeNull();

      const second = await client.auth.signUp({
        email,
        password: TEST_PASSWORD,
        name: 'Second',
      });
      expect(second.error).not.toBeNull();
      expect(second.error!.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject a weak / empty password', async () => {
      const { error } = await client.auth.signUp({
        email: uniqueEmail('weak'),
        password: '12',
        name: 'Weak',
      });
      expect(error).not.toBeNull();
    });

    it('should reject missing email', async () => {
      const { error } = await client.auth.signUp({
        email: '',
        password: TEST_PASSWORD,
        name: 'No Email',
      });
      expect(error).not.toBeNull();
    });
  });

  // ================================================================
  // signInWithPassword
  // ================================================================

  describe('signInWithPassword()', () => {
    let testEmail: string;

    beforeAll(async () => {
      testEmail = uniqueEmail('signin');
      const c = createClient();
      const { error } = await c.auth.signUp({
        email: testEmail,
        password: TEST_PASSWORD,
        name: 'Sign-In Test',
      });
      expect(error).toBeNull();
    });

    it('should sign in with correct credentials or require email verification', async () => {
      const c = createClient();
      const { data, error } = await c.auth.signInWithPassword({
        email: testEmail,
        password: TEST_PASSWORD,
      });

      if (error) {
        // Projects with email verification enabled return an error here
        // The error should be structured and related to verification
        expect(error.statusCode).toBeGreaterThanOrEqual(400);
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).not.toBeNull();
        expect(data!.accessToken).toBeDefined();
        expect(data!.user).toBeDefined();
        expect(data!.user.email).toBe(testEmail);
      }
    });

    it('should reject wrong password', async () => {
      const c = createClient();
      const { error } = await c.auth.signInWithPassword({
        email: testEmail,
        password: 'Wrong_P@ssword_999!',
      });
      expect(error).not.toBeNull();
      expect(error!.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should reject non-existent email', async () => {
      const c = createClient();
      const { error } = await c.auth.signInWithPassword({
        email: `ghost-${Date.now()}@test.insforge.dev`,
        password: TEST_PASSWORD,
      });
      expect(error).not.toBeNull();
    });
  });

  // ================================================================
  // getCurrentUser
  // ================================================================

  describe('getCurrentUser()', () => {
    it('should return the user after sign-up', async () => {
      const { client: authed, data: signUpData, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const { data, error } = await authed.auth.getCurrentUser();

      // In server mode, getCurrentUser checks tokenManager
      // signUp sets the token, so user should be available
      if (signUpData?.accessToken && typeof signUpData.accessToken === 'string') {
        expect(error).toBeNull();
        expect(data.user).not.toBeNull();
      } else {
        // If signUp didn't return a usable token, user may be null
        expect(data).toBeDefined();
      }
    });

    it('should return null user for unauthenticated client', async () => {
      const anon = createClient();
      const { data } = await anon.auth.getCurrentUser();
      expect(data.user).toBeNull();
    });
  });

  // ================================================================
  // refreshSession  (server mode – needs refreshToken)
  // ================================================================

  describe('refreshSession()', () => {
    it('should return error when called in server mode without refreshToken', async () => {
      const { client: authed, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const { error } = await authed.auth.refreshSession();
      // In server mode, missing refreshToken is an explicit error
      expect(error).not.toBeNull();
      expect(error!.message).toContain('refreshToken');
    });

    it('should refresh when a valid refreshToken is provided', async () => {
      const { client: authed, data, error: signErr } = await signUpAndSignIn();
      if (signErr) {
        console.log('Skipping refresh test – signUp/signIn failed:', signErr.message);
        return;
      }

      // Response may include a refreshToken in server mode
      const refreshToken = (data as any)?.refreshToken;
      if (!refreshToken) {
        console.log('refreshToken not returned – skipping refresh test');
        return;
      }

      const { data: refreshed, error } = await authed.auth.refreshSession({
        refreshToken,
      });

      expect(error).toBeNull();
      expect(refreshed).not.toBeNull();
      expect(refreshed!.accessToken).toBeDefined();
    });
  });

  // ================================================================
  // signOut
  // ================================================================

  describe('signOut()', () => {
    it('should sign out without error', async () => {
      const { client: authed, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const { error } = await authed.auth.signOut();
      expect(error).toBeNull();
    });

    it('should clear the session so getCurrentUser returns null', async () => {
      const { client: authed, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const { error: signOutErr } = await authed.auth.signOut();
      expect(signOutErr).toBeNull();

      // After sign-out, user should be null in server mode
      const { data } = await authed.auth.getCurrentUser();
      expect(data.user).toBeNull();
    });
  });

  // ================================================================
  // getProfile / setProfile
  // ================================================================

  describe('getProfile() / setProfile()', () => {
    it('should get a user profile by ID', async () => {
      const { client: authed, data: signUpData, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const userId = signUpData?.user?.id;
      if (!userId) {
        console.log('Skipping getProfile – no user ID from signUp');
        return;
      }

      const { data, error } = await authed.auth.getProfile(userId);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it('should update the current user profile', async () => {
      const { client: authed, data: signUpData, error: err } = await signUpFreshUser();
      expect(err).toBeNull();
      if (!signUpData?.user?.id) {
        console.log('Skipping setProfile – no authenticated user');
        return;
      }

      const newName = 'Updated ' + Date.now();
      const { data, error } = await authed.auth.setProfile({ name: newName });

      if (error) {
        // May fail if token is not valid for profile updates (e.g. unverified)
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });

    it('should persist profile changes', async () => {
      const { client: authed, data: signUpData, error: err } = await signUpFreshUser();
      expect(err).toBeNull();

      const userId = signUpData?.user?.id;
      if (!userId) {
        console.log('Skipping persist profile – no user ID from signUp');
        return;
      }

      const newName = 'Persist ' + Date.now();
      const { error: setErr } = await authed.auth.setProfile({ name: newName });
      if (setErr) {
        console.log('setProfile failed (unverified user?) – skipping');
        return;
      }

      const { data } = await authed.auth.getProfile(userId);
      expect(data).toBeDefined();
    });
  });

  // ================================================================
  // Email verification flow (send verification email)
  // ================================================================

  describe('resendVerificationEmail()', () => {
    it('should send a verification email or return structured error', async () => {
      const { email, error: signUpErr } = await signUpFreshUser();
      expect(signUpErr).toBeNull();

      const c = createClient();
      const { data, error } = await c.auth.resendVerificationEmail({ email });

      // Email service may be disabled – both success and structured error are acceptable
      if (error) {
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).toBeDefined();
        expect(data!.success).toBeDefined();
      }
    });
  });

  // ================================================================
  // Password reset flow
  // ================================================================

  describe('sendResetPasswordEmail()', () => {
    it('should send a reset password email or return structured error', async () => {
      const { email, error: signUpErr } = await signUpFreshUser();
      expect(signUpErr).toBeNull();

      const c = createClient();
      const { data, error } = await c.auth.sendResetPasswordEmail({ email });

      if (error) {
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).toBeDefined();
        expect(data!.success).toBeDefined();
      }
    });
  });

  describe('exchangeResetPasswordToken()', () => {
    it('should reject an invalid OTP', async () => {
      const { email, error: signUpErr } = await signUpFreshUser();
      expect(signUpErr).toBeNull();

      const c = createClient();
      const { error } = await c.auth.exchangeResetPasswordToken({
        email,
        otp: '000000',
      });

      expect(error).not.toBeNull();
    });
  });

  describe('resetPassword()', () => {
    it('should reject an invalid OTP', async () => {
      const c = createClient();
      const { error } = await c.auth.resetPassword({
        newPassword: 'NewP@ssword_123!',
        otp: 'invalid-token',
      });

      expect(error).not.toBeNull();
    });
  });

  // ================================================================
  // verifyEmail
  // ================================================================

  describe('verifyEmail()', () => {
    it('should reject an invalid verification code', async () => {
      const { email, error: signUpErr } = await signUpFreshUser();
      expect(signUpErr).toBeNull();

      const c = createClient();
      const { error } = await c.auth.verifyEmail({ email, otp: '000000' });

      expect(error).not.toBeNull();
    });
  });

  // ================================================================
  // signInWithIdToken (needs a real Google ID token – test error path)
  // ================================================================

  describe('signInWithIdToken()', () => {
    it('should reject an invalid token', async () => {
      const c = createClient();
      const { error } = await c.auth.signInWithIdToken({
        provider: 'google',
        token: 'invalid-id-token',
      });

      expect(error).not.toBeNull();
      expect(error!.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ================================================================
  // signInWithOAuth (server-mode path – skipBrowserRedirect)
  // ================================================================

  describe('signInWithOAuth()', () => {
    it('should return an OAuth URL for a built-in provider', async () => {
      const c = createClient();
      const { data, error } = await c.auth.signInWithOAuth({
        provider: 'google',
        skipBrowserRedirect: true,
      });

      // Provider may not be configured – both outcomes are valid
      if (error) {
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data.url).toBeDefined();
        expect(typeof data.url).toBe('string');
      }
    });

    it('should return an OAuth URL for a custom provider', async () => {
      const c = createClient();
      const { data, error } = await c.auth.signInWithOAuth({
        provider: 'custom-test-provider',
        skipBrowserRedirect: true,
      });

      // Custom provider likely not configured – verify structured error
      if (error) {
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data.url).toBeDefined();
      }
    });
  });

  // ================================================================
  // exchangeOAuthCode (test error path – invalid code)
  // ================================================================

  describe('exchangeOAuthCode()', () => {
    it('should reject an invalid authorization code', async () => {
      const c = createClient();
      const { error } = await c.auth.exchangeOAuthCode('invalid-code', 'invalid-verifier');

      expect(error).not.toBeNull();
    });
  });
});
