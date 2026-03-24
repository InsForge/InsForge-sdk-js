import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { signUpAndSignIn, createClient, getTestEnv } from './setup';
import type { InsForgeClient } from '../src/client';

/**
 * Realtime module integration tests.
 *
 * Public API tested:
 *   realtime.connect()
 *   realtime.disconnect()
 *   realtime.subscribe(channel)
 *   realtime.unsubscribe(channel)
 *   realtime.publish(channel, event, payload)
 *   realtime.on(event, callback)
 *   realtime.off(event, callback)
 *   realtime.once(event, callback)
 *   realtime.getSubscribedChannels()
 *   realtime.isConnected          (getter)
 *   realtime.connectionState      (getter)
 *   realtime.socketId             (getter)
 *
 * NOTE: Realtime requires a socket.io server on the test project.
 * If the server is unreachable the tests verify that errors are
 * properly surfaced rather than crashing.
 */

describe('Realtime Module', () => {
  let client: InsForgeClient;
  let realtimeAvailable = true;

  beforeAll(async () => {
    const result = await signUpAndSignIn();
    expect(result.error).toBeNull();
    client = result.client;
  });

  afterAll(() => {
    // Always disconnect to avoid hanging sockets
    try { client.realtime.disconnect(); } catch { /* ignore */ }
  });

  // ================================================================
  // Pre-connection state
  // ================================================================

  describe('initial state', () => {
    it('isConnected should be false before connect()', () => {
      const c = createClient();
      expect(c.realtime.isConnected).toBe(false);
    });

    it('connectionState should be "disconnected"', () => {
      const c = createClient();
      expect(c.realtime.connectionState).toBe('disconnected');
    });

    it('socketId should be undefined', () => {
      const c = createClient();
      expect(c.realtime.socketId).toBeUndefined();
    });

    it('getSubscribedChannels() should be empty', () => {
      const c = createClient();
      expect(c.realtime.getSubscribedChannels()).toEqual([]);
    });
  });

  // ================================================================
  // connect / disconnect
  // ================================================================

  describe('connect()', () => {
    it('should connect or throw a meaningful error', async () => {
      try {
        await client.realtime.connect();
        realtimeAvailable = true;
      } catch (err: any) {
        realtimeAvailable = false;
        // Connection may fail (server down, not configured)
        expect(err.message).toBeDefined();
        console.warn('⚠ Realtime not available:', err.message);
        return;
      }

      // Assertions outside try/catch so failures are not masked
      expect(client.realtime.isConnected).toBe(true);
      expect(client.realtime.connectionState).toBe('connected');
      expect(client.realtime.socketId).toBeDefined();
    });
  });

  describe('disconnect()', () => {
    it('should disconnect cleanly', async () => {
      if (!realtimeAvailable) return;

      // Ensure connected first
      if (!client.realtime.isConnected) {
        try { await client.realtime.connect(); } catch { return; }
      }

      client.realtime.disconnect();
      expect(client.realtime.isConnected).toBe(false);
      expect(client.realtime.connectionState).toBe('disconnected');
    });

    it('should be safe to call when already disconnected', () => {
      const c = createClient();
      // Should not throw
      c.realtime.disconnect();
      expect(c.realtime.isConnected).toBe(false);
    });
  });

  // ================================================================
  // subscribe / unsubscribe
  // ================================================================

  describe('subscribe() / unsubscribe()', () => {
    beforeAll(async () => {
      if (!realtimeAvailable) return;
      try { await client.realtime.connect(); } catch { realtimeAvailable = false; }
    });

    afterEach(() => {
      // Clean up subscriptions
      for (const ch of client.realtime.getSubscribedChannels()) {
        client.realtime.unsubscribe(ch);
      }
    });

    it('should subscribe to a channel', async () => {
      if (!realtimeAvailable) return;

      const channel = `test-${Date.now()}`;
      const response = await client.realtime.subscribe(channel);

      expect(response).toBeDefined();
      expect(response.ok).toBe(true);
      expect(response.channel).toBe(channel);
      expect(client.realtime.getSubscribedChannels()).toContain(channel);
    });

    it('should return success for duplicate subscribe', async () => {
      if (!realtimeAvailable) return;

      const channel = `dup-${Date.now()}`;
      await client.realtime.subscribe(channel);
      const second = await client.realtime.subscribe(channel);

      // Second call returns cached success
      expect(second.ok).toBe(true);
    });

    it('unsubscribe() should remove the channel', async () => {
      if (!realtimeAvailable) return;

      const channel = `unsub-${Date.now()}`;
      await client.realtime.subscribe(channel);
      expect(client.realtime.getSubscribedChannels()).toContain(channel);

      client.realtime.unsubscribe(channel);
      expect(client.realtime.getSubscribedChannels()).not.toContain(channel);
    });
  });

  // ================================================================
  // on / off / once
  // ================================================================

  describe('on() / off() / once()', () => {
    it('on() should register an event listener', () => {
      const c = createClient();
      const cb = () => {};
      // Should not throw
      c.realtime.on('test-event', cb);
    });

    it('off() should remove an event listener', () => {
      const c = createClient();
      const cb = () => {};
      c.realtime.on('test-event', cb);
      c.realtime.off('test-event', cb);
      // No public way to check listener count, but should not throw
    });

    it('once() should register a one-shot listener', () => {
      const c = createClient();
      const cb = () => {};
      // Should not throw
      c.realtime.once('test-event', cb);
    });
  });

  // ================================================================
  // publish
  // ================================================================

  describe('publish()', () => {
    it('should throw when not connected', async () => {
      const c = createClient();
      await expect(
        c.realtime.publish('test-channel', 'test-event', { msg: 'hello' })
      ).rejects.toThrow(/not connected/i);
    });

    it('should publish when connected', async () => {
      if (!realtimeAvailable) return;

      if (!client.realtime.isConnected) {
        try { await client.realtime.connect(); } catch { return; }
      }

      const channel = `pub-${Date.now()}`;
      await client.realtime.subscribe(channel);

      // Should not throw
      await client.realtime.publish(channel, 'test-event', { ts: Date.now() });
    });
  });

  // ================================================================
  // getSubscribedChannels
  // ================================================================

  describe('getSubscribedChannels()', () => {
    it('should return an array of channel names', async () => {
      if (!realtimeAvailable) return;

      if (!client.realtime.isConnected) {
        try { await client.realtime.connect(); } catch { return; }
      }

      const ch1 = `ch1-${Date.now()}`;
      const ch2 = `ch2-${Date.now()}`;
      await client.realtime.subscribe(ch1);
      await client.realtime.subscribe(ch2);

      const channels = client.realtime.getSubscribedChannels();
      expect(Array.isArray(channels)).toBe(true);
      expect(channels).toContain(ch1);
      expect(channels).toContain(ch2);

      // Cleanup
      client.realtime.unsubscribe(ch1);
      client.realtime.unsubscribe(ch2);
    });
  });
});
