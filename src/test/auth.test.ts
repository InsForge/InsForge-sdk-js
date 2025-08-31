import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsForgeClient } from '../client';
import { InsForgeError } from '../types';

describe('InsForge SDK - Auth Module', () => {
  let client: InsForgeClient;

  beforeEach(() => {
    // Create a new client for each test
    client = new InsForgeClient({
      url: 'http://localhost:7130',
    });
  });

  describe('User Registration', () => {
    it('should register a new user', async () => {
      // Generate unique email for test
      const email = `test-${Date.now()}@example.com`;
      
      const { data, error } = await client.auth.signUp({
        email,
        password: 'testpass123',
        name: 'Test User'
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.accessToken).toBeDefined();
      expect(data?.user).toBeDefined();
      expect(data?.user?.email).toBe(email);
      expect(data?.user?.name).toBe('Test User');
      expect(data?.user?.emailVerified).toBe(false);
    });

    it('should fail to register with existing email', async () => {
      const email = `duplicate-${Date.now()}@example.com`;
      
      // First registration should succeed
      const { error: firstError } = await client.auth.signUp({
        email,
        password: 'testpass123',
      });
      expect(firstError).toBeNull();

      // Second registration with same email should fail
      const { error: secondError } = await client.auth.signUp({
        email,
        password: 'testpass123',
      });
      expect(secondError).toBeDefined();
      expect(secondError?.message).toContain('already exists');
    });
  });

  describe('User Login', () => {
    it('should login with valid credentials', async () => {
      const email = `login-${Date.now()}@example.com`;
      const password = 'testpass123';
      
      // Register first
      await client.auth.signUp({
        email,
        password,
        name: 'Login Test'
      });

      // Create new client to test fresh login
      const newClient = new InsForgeClient({
        url: 'http://localhost:7130',
      });

      // Login
      const { data, error } = await newClient.auth.signInWithPassword({
        email,
        password,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.accessToken).toBeDefined();
      expect(data?.user?.email).toBe(email);
      expect(data?.user?.name).toBe('Login Test');
    });

    it('should fail to login with invalid credentials', async () => {
      const { error } = await client.auth.signInWithPassword({
        email: 'nonexistent@example.com',
        password: 'wrongpass',
      });
      
      expect(error).toBeDefined();
      expect(error?.message).toContain('Invalid credentials');
    });
  });

  describe('Session Management', () => {
    it('should get current user when authenticated', async () => {
      const email = `session-${Date.now()}@example.com`;
      
      // Register and login
      await client.auth.signUp({
        email,
        password: 'testpass123',
        name: 'Session Test'
      });

      // Get current user (only returns partial data from API)
      const { data, error } = await client.auth.getCurrentUser();
      
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.user).toBeDefined();
      expect(data?.user.email).toBe(email);
      expect(data?.user.role).toBe('authenticated');
    });

    it('should return null when not authenticated', async () => {
      const { data, error } = await client.auth.getCurrentUser();
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it('should get session', async () => {
      // Initially no session
      let { data: sessionData } = await client.auth.getSession();
      expect(sessionData.session).toBeNull();

      // Register
      const email = `auth-check-${Date.now()}@example.com`;
      await client.auth.signUp({
        email,
        password: 'testpass123',
      });

      // Now should have session
      sessionData = (await client.auth.getSession()).data;
      expect(sessionData.session).toBeDefined();
      expect(sessionData.session?.accessToken).toBeDefined();

      // After logout, should have no session
      await client.auth.signOut();
      sessionData = (await client.auth.getSession()).data;
      expect(sessionData.session).toBeNull();
    });
  });


  describe('OAuth', () => {
    it('should get Google OAuth URL', async () => {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        redirectTo: 'http://localhost:3000/callback',
        skipBrowserRedirect: true
      });

      // OAuth might not be configured, which is fine for this test
      if (error) {
        expect(error).toBeInstanceOf(InsForgeError);
        expect(error.message).toContain('OAuth');
      } else {
        expect(data.url).toBeDefined();
        expect(data.provider).toBe('google');
      }
    });

    it('should get GitHub OAuth URL', async () => {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'github',
        redirectTo: 'http://localhost:3000/callback',
        skipBrowserRedirect: true
      });

      // OAuth might not be configured, which is fine for this test
      if (error) {
        expect(error).toBeInstanceOf(InsForgeError);
        expect(error.message).toContain('OAuth');
      } else {
        expect(data.url).toBeDefined();
        expect(data.provider).toBe('github');
      }
    });
  });


});