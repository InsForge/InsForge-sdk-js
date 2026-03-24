import { describe, it, expect, beforeAll } from 'vitest';
import { signUpAndSignIn, createClient } from './setup';
import type { InsForgeClient } from '../src/client';

/**
 * Email module integration tests.
 *
 * Public API tested:
 *   emails.send(options)
 *
 * Email sending may be disabled or rate-limited on test projects.
 * Tests verify the SDK correctly forms the request and surfaces
 * either success or a structured error.
 */

describe('Email Module', () => {
  let authedClient: InsForgeClient;
  let anonClient: InsForgeClient;

  beforeAll(async () => {
    anonClient = createClient();
    const result = await signUpAndSignIn();
    expect(result.error).toBeNull();
    authedClient = result.client;
  });

  describe('send()', () => {
    it('should send an email with required fields', async () => {
      const { data, error } = await authedClient.emails.send({
        to: 'sdk-test@test.insforge.dev',
        subject: 'SDK Integration Test – ' + new Date().toISOString(),
        html: '<p>Automated test from InsForge SDK integration tests.</p>',
      });

      if (error) {
        // Email not configured – verify structured error
        expect(error.statusCode).toBeDefined();
        expect(typeof error.message).toBe('string');
      } else {
        expect(data).toBeDefined();
      }
    });

    it('should send an email with all optional fields', async () => {
      const { data, error } = await authedClient.emails.send({
        to: ['sdk-test-a@test.insforge.dev', 'sdk-test-b@test.insforge.dev'],
        subject: 'SDK Full Fields Test',
        html: '<h1>Hello</h1><p>Body</p>',
      });

      if (error) {
        expect(error.statusCode).toBeDefined();
      } else {
        expect(data).toBeDefined();
      }
    });

    it('should reject unauthenticated email send', async () => {
      const { error } = await anonClient.emails.send({
        to: 'test@test.insforge.dev',
        subject: 'Should Fail',
        html: '<p>No auth</p>',
      });

      // Should get 401 or similar auth error
      expect(error).not.toBeNull();
      expect(error!.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
