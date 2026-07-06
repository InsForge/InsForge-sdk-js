import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Realtime, type PresenceSyncEvent } from '../realtime';
import { TokenManager } from '../../lib/token-manager';
import type { SubscribeResponse } from '@insforge/shared-schemas';

function jwtWithPayload(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encoded}.signature`;
}

function userJwt(sub: string, iat = 0): string {
  return jwtWithPayload({ sub, role: 'authenticated', iat });
}

type EmittedEvent = {
  event: string;
  payload: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ack?: (response: any) => void;
};

class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  anyHandlers: Array<(...args: unknown[]) => void> = [];
  emitted: EmittedEvent[] = [];
  connected = false;
  auth: unknown;
  id = 'socket-1';
  connectCalls = 0;
  disconnectCalls = 0;

  constructor(auth: unknown) {
    this.auth = auth;
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      list.filter((h) => h !== cb)
    );
  }

  onAny(cb: (...args: unknown[]) => void): void {
    this.anyHandlers.push(cb);
  }

  emit(event: string, payload: unknown, ack?: EmittedEvent['ack']): void {
    this.emitted.push({ event, payload, ack });
  }

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  // Test helpers
  fire(event: string, ...args: unknown[]): void {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const cb of [...(this.handlers.get(event) ?? [])]) {
      cb(...args);
    }
  }

  fireServerEvent(event: string, message: unknown): void {
    for (const cb of this.anyHandlers) {
      cb(event, message);
    }
  }

  lastEmit(event: string): EmittedEvent | undefined {
    return [...this.emitted].reverse().find((e) => e.event === event);
  }

  emitsOf(event: string): EmittedEvent[] {
    return this.emitted.filter((e) => e.event === event);
  }
}

let currentSocket: FakeSocket | null = null;

vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, opts?: { auth?: unknown }) => {
    currentSocket = new FakeSocket(opts?.auth);
    return currentSocket;
  }),
}));

function okResponse(channel: string, presenceIds: string[]): SubscribeResponse {
  return {
    ok: true,
    channel,
    presence: {
      members: presenceIds.map((presenceId) => ({
        type: 'user' as const,
        presenceId,
        joinedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
  };
}

async function connectRealtime(realtime: Realtime): Promise<FakeSocket> {
  const promise = realtime.connect();
  await vi.waitFor(() => {
    if (!currentSocket) throw new Error('socket not created yet');
  });
  const socket = currentSocket!;
  socket.fire('connect');
  await promise;
  return socket;
}

describe('Realtime', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    currentSocket = null;
    tokenManager = new TokenManager();
  });

  function createRealtime(anonKey?: string): Realtime {
    return new Realtime('http://localhost:7130', tokenManager, anonKey);
  }

  describe('subscribe()', () => {
    it('resolves the server presence snapshot and emits presence:sync', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const syncEvents: PresenceSyncEvent[] = [];
      realtime.on<PresenceSyncEvent>('presence:sync', (e) => syncEvents.push(e));

      const promise = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me', 'other']));
      const response = await promise;

      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.presence.members.map((m) => m.presenceId)).toEqual(['me', 'other']);
      }
      expect(realtime.getSubscribedChannels()).toEqual(['room:1']);
      expect(syncEvents).toHaveLength(1);
      expect(syncEvents[0].presence.members).toHaveLength(2);
    });

    it('re-subscribing an already-subscribed channel returns a fresh server snapshot', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const first = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me']));
      await first;

      // Regression: this used to short-circuit with a fabricated empty snapshot
      const second = realtime.subscribe('room:1');
      expect(socket.emitsOf('realtime:subscribe')).toHaveLength(2);
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me', 'other']));
      const response = await second;

      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.presence.members.map((m) => m.presenceId)).toEqual(['me', 'other']);
      }
      expect(realtime.getSubscribedChannels()).toEqual(['room:1']);
    });

    it('does not track the channel when the server rejects the subscribe', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const promise = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!({
        ok: false,
        channel: 'room:1',
        error: { code: 'REALTIME_UNAUTHORIZED', message: 'denied' },
      });
      const response = await promise;

      expect(response.ok).toBe(false);
      expect(realtime.getSubscribedChannels()).toEqual([]);
    });
  });

  describe('reconnect', () => {
    it('re-subscribes with an ack and surfaces the fresh snapshot via presence:sync', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const first = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me', 'other']));
      await first;

      const syncEvents: PresenceSyncEvent[] = [];
      realtime.on<PresenceSyncEvent>('presence:sync', (e) => syncEvents.push(e));

      socket.fire('disconnect', 'transport close');
      socket.fire('connect');

      const resubscribe = socket.emitsOf('realtime:subscribe')[1];
      expect(resubscribe).toBeDefined();
      expect(resubscribe.ack).toBeTypeOf('function');

      resubscribe.ack!(okResponse('room:1', ['me', 'other', 'joined-while-away']));

      expect(syncEvents).toHaveLength(1);
      expect(syncEvents[0].channel).toBe('room:1');
      expect(syncEvents[0].presence.members.map((m) => m.presenceId)).toEqual([
        'me',
        'other',
        'joined-while-away',
      ]);
      expect(realtime.getSubscribedChannels()).toEqual(['room:1']);
    });

    it('drops the channel and emits error when the resubscribe is denied', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const first = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me']));
      await first;

      const errors: Array<{ channel?: string; code: string; message: string }> = [];
      realtime.on<{ channel?: string; code: string; message: string }>('error', (e) =>
        errors.push(e)
      );

      socket.fire('disconnect', 'transport close');
      socket.fire('connect');

      socket.emitsOf('realtime:subscribe')[1].ack!({
        ok: false,
        channel: 'room:1',
        error: { code: 'REALTIME_UNAUTHORIZED', message: 'denied' },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('REALTIME_UNAUTHORIZED');
      expect(realtime.getSubscribedChannels()).toEqual([]);
    });
  });

  describe('token changes', () => {
    it('does not bounce the socket when the same user refreshes their token', async () => {
      tokenManager.setAccessToken(userJwt('user-1', 1));
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const refreshed = userJwt('user-1', 2);
      tokenManager.setAccessToken(refreshed);

      expect(socket.disconnectCalls).toBe(0);
      expect(socket.connectCalls).toBe(0);
      // Future reconnects still pick up the fresh token
      expect(socket.auth).toEqual({ token: refreshed });
      expect(realtime.isConnected).toBe(true);
    });

    it('bounces the socket when the signed-in user changes', async () => {
      tokenManager.setAccessToken(userJwt('user-1'));
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      tokenManager.setAccessToken(userJwt('user-2'));

      expect(socket.disconnectCalls).toBe(1);
      expect(socket.connectCalls).toBe(1);
      expect(socket.auth).toEqual({ token: userJwt('user-2') });
    });

    it('bounces the socket on sign-out (user -> anon key)', async () => {
      tokenManager.setAccessToken(userJwt('user-1'));
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      tokenManager.clearSession();

      expect(socket.disconnectCalls).toBe(1);
      expect(socket.connectCalls).toBe(1);
      expect(socket.auth).toEqual({ token: 'anon_key' });
    });

    it('bounces the socket on sign-in (anon key -> user)', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      tokenManager.setAccessToken(userJwt('user-1'));

      expect(socket.disconnectCalls).toBe(1);
      expect(socket.connectCalls).toBe(1);
    });

    it('re-authenticates the live socket in-band on same-user refresh', async () => {
      tokenManager.setAccessToken(userJwt('user-1', 1));
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const refreshed = userJwt('user-1', 2);
      tokenManager.setAccessToken(refreshed);

      const authEmit = socket.lastEmit('realtime:auth');
      expect(authEmit).toBeDefined();
      expect(authEmit!.payload).toEqual({ token: refreshed });

      authEmit!.ack!({ ok: true });
      expect(socket.disconnectCalls).toBe(0);
      expect(socket.connectCalls).toBe(0);
    });

    it('falls back to a reconnect when the server rejects the refreshed token', async () => {
      tokenManager.setAccessToken(userJwt('user-1', 1));
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      tokenManager.setAccessToken(userJwt('user-1', 2));
      socket.lastEmit('realtime:auth')!.ack!({
        ok: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'invalid' },
      });

      expect(socket.disconnectCalls).toBe(1);
      expect(socket.connectCalls).toBe(1);
    });
  });

  describe('getPresenceState()', () => {
    it('tracks the snapshot and join/leave deltas', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const promise = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me', 'other']));
      await promise;

      expect(realtime.getPresenceState('room:1').map((m) => m.presenceId)).toEqual([
        'me',
        'other',
      ]);

      socket.fireServerEvent('presence:join', {
        member: { type: 'user', presenceId: 'third', joinedAt: '2026-01-01T00:00:01.000Z' },
        meta: { channel: 'room:1' },
      });
      expect(realtime.getPresenceState('room:1').map((m) => m.presenceId)).toEqual([
        'me',
        'other',
        'third',
      ]);

      socket.fireServerEvent('presence:leave', {
        member: { type: 'user', presenceId: 'other', joinedAt: '2026-01-01T00:00:00.000Z' },
        meta: { channel: 'room:1' },
      });
      expect(realtime.getPresenceState('room:1').map((m) => m.presenceId)).toEqual([
        'me',
        'third',
      ]);

      realtime.unsubscribe('room:1');
      expect(realtime.getPresenceState('room:1')).toEqual([]);
    });

    it('replaces the state with the fresh snapshot on reconnect', async () => {
      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);

      const promise = realtime.subscribe('room:1');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me', 'other']));
      await promise;

      socket.fire('disconnect', 'transport close');
      // Last known state is retained while disconnected
      expect(realtime.getPresenceState('room:1')).toHaveLength(2);

      socket.fire('connect');
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me']));

      expect(realtime.getPresenceState('room:1').map((m) => m.presenceId)).toEqual(['me']);
    });
  });

  describe('connect() socket reuse', () => {
    it('does not create a second socket when auto-connecting during a disconnect', async () => {
      const { io } = await import('socket.io-client');
      const ioMock = vi.mocked(io);
      ioMock.mockClear();

      const realtime = createRealtime('anon_key');
      const socket = await connectRealtime(realtime);
      expect(ioMock).toHaveBeenCalledTimes(1);

      socket.fire('disconnect', 'transport close');

      const promise = realtime.subscribe('room:1');
      await vi.waitFor(() => {
        if (socket.connectCalls !== 1) throw new Error('reconnect not requested yet');
      });
      expect(ioMock).toHaveBeenCalledTimes(1);

      socket.fire('connect');
      await vi.waitFor(() => {
        if (!socket.lastEmit('realtime:subscribe')) throw new Error('no subscribe yet');
      });
      socket.lastEmit('realtime:subscribe')!.ack!(okResponse('room:1', ['me']));

      const response = await promise;
      expect(response.ok).toBe(true);
      expect(realtime.isConnected).toBe(true);
    });
  });
});
