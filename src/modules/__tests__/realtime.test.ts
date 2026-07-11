import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PresenceJoinMessage,
  PresenceLeaveMessage,
  SubscribeResponse,
} from '@insforge/shared-schemas';
import { Realtime } from '../realtime';
import { TokenManager } from '../../lib/token-manager';

type Listener = (...args: any[]) => void;

class FakeSocket {
  connected = false;
  id = 'socket-1';
  disconnect = vi.fn(() => {
    this.connected = false;
  });
  connect = vi.fn();
  emit = vi.fn();
  private listeners = new Map<string, Listener[]>();
  private anyListeners: Listener[] = [];

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  onAny(listener: Listener): this {
    this.anyListeners.push(listener);
    return this;
  }

  off(event: string, listener?: Listener): this {
    if (listener) {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener)
      );
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  offAny(listener?: Listener): this {
    this.anyListeners = listener
      ? this.anyListeners.filter((candidate) => candidate !== listener)
      : [];
    return this;
  }

  trigger(event: string, ...args: unknown[]): void {
    if (event === 'connect') {
      this.connected = true;
    }
    if (event === 'disconnect') {
      this.connected = false;
    }
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  triggerAny(event: string, message: unknown): void {
    for (const listener of this.anyListeners) {
      listener(event, message);
    }
  }
}

let socket: FakeSocket;
let socketOptions: { auth?: unknown } | undefined;
const { io } = vi.hoisted(() => ({ io: vi.fn() }));

vi.mock('socket.io-client', () => ({ io }));

function jwt(expirationOffsetSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expirationOffsetSeconds })
  ).toString('base64url');
  return `header.${payload}.signature`;
}

async function connect(realtime: Realtime): Promise<FakeSocket> {
  const promise = realtime.connect();
  await vi.waitFor(() => expect(socket).toBeDefined());
  socket.trigger('connect');
  await promise;
  return socket;
}

function latestSubscribeAck(): (response: SubscribeResponse) => void {
  const calls = socket.emit.mock.calls.filter(([event]) => event === 'realtime:subscribe');
  return calls.at(-1)?.[2] as (response: SubscribeResponse) => void;
}

describe('Realtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    socket = undefined as never;
    socketOptions = undefined;
    io.mockImplementation((_url: string, options: { auth?: unknown }) => {
      socketOptions = options;
      socket = new FakeSocket();
      return socket;
    });
  });

  it('keeps an established socket connected when an access token is refreshed', async () => {
    const tokens = new TokenManager();
    tokens.setAccessToken(jwt(300));
    const realtime = new Realtime('http://example.test', tokens);
    await connect(realtime);

    tokens.setAccessToken(jwt(600), 'tokenRefreshed');

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('reconnects an established socket when the authentication identity changes', async () => {
    const tokens = new TokenManager();
    tokens.setAccessToken(jwt(300));
    const realtime = new Realtime('http://example.test', tokens);
    await connect(realtime);

    tokens.setAccessToken(jwt(600), 'signedIn');

    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it('reads the latest token each time Socket.IO performs a handshake', async () => {
    const tokens = new TokenManager();
    tokens.setAccessToken(jwt(300));
    const realtime = new Realtime('http://example.test', tokens);
    await connect(realtime);

    const refreshedToken = jwt(600);
    tokens.setAccessToken(refreshedToken, 'tokenRefreshed');

    if (typeof socketOptions?.auth !== 'function') {
      expect(socketOptions?.auth).toBeTypeOf('function');
      return;
    }
    const auth = socketOptions.auth as (callback: (payload: { token?: string }) => void) => void;
    const callback = vi.fn();
    auth(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({ token: refreshedToken }));
  });

  it('does not restore a subscription when an acknowledgement arrives after unsubscribe', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    const subscription = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));

    const acknowledge = latestSubscribeAck();
    realtime.unsubscribe('room');
    acknowledge({ ok: true, channel: 'room', presence: { members: [] } });

    expect((realtime as any).subscriptions.get('room')).toBeUndefined();
    await expect(subscription).resolves.toMatchObject({ ok: false, channel: 'room' });
    expect(realtime.getSubscribedChannels()).toEqual([]);
  });

  it('settles an in-flight subscription on disconnect and retries it after reconnect', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    const subscription = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));

    socket.trigger('disconnect', 'transport close');

    await expect(subscription).resolves.toMatchObject({
      ok: false,
      channel: 'room',
      error: { code: 'DISCONNECTED' },
    });
    expect(realtime.getSubscribedChannels()).toEqual([]);

    socket.trigger('connect');
    const acknowledge = latestSubscribeAck();
    acknowledge({ ok: true, channel: 'room', presence: { members: [] } });

    await expect(realtime.subscribe('room')).resolves.toMatchObject({ ok: true, channel: 'room' });
  });

  it('ignores a disconnected socket acknowledgement before resubscribing', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    const subscription = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));
    const staleAcknowledge = latestSubscribeAck();

    socket.trigger('disconnect', 'transport close');
    await expect(subscription).resolves.toMatchObject({
      ok: false,
      error: { code: 'DISCONNECTED' },
    });

    staleAcknowledge({ ok: true, channel: 'room', presence: { members: [] } });
    socket.trigger('connect');

    expect(socket.emit.mock.calls.filter(([event]) => event === 'realtime:subscribe')).toHaveLength(
      2
    );

    const resubscription = realtime.subscribe('room');
    latestSubscribeAck()({ ok: true, channel: 'room', presence: { members: [] } });
    await expect(resubscription).resolves.toMatchObject({ ok: true, channel: 'room' });
    expect(realtime.getSubscribedChannels()).toEqual(['room']);
  });

  it('pauses a server-rejected subscription until the caller explicitly retries it', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);

    const rejected = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));
    latestSubscribeAck()({
      ok: false,
      channel: 'room',
      error: {
        code: 'REALTIME_UNAUTHORIZED',
        message: 'Not authorized to subscribe to this channel',
      },
    });

    await expect(rejected).resolves.toMatchObject({
      ok: false,
      error: { code: 'REALTIME_UNAUTHORIZED' },
    });
    expect(realtime.getSubscribedChannels()).toEqual([]);

    socket.trigger('disconnect', 'transport close');
    socket.trigger('connect');
    expect(socket.emit.mock.calls.filter(([event]) => event === 'realtime:subscribe')).toHaveLength(
      1
    );

    const retried = realtime.subscribe('room');
    await vi.waitFor(() =>
      expect(
        socket.emit.mock.calls.filter(([event]) => event === 'realtime:subscribe')
      ).toHaveLength(2)
    );
    latestSubscribeAck()({ ok: true, channel: 'room', presence: { members: [] } });

    await expect(retried).resolves.toMatchObject({ ok: true, channel: 'room' });
    expect(realtime.getSubscribedChannels()).toEqual(['room']);
  });

  it('retries a rejected subscription after an authentication-boundary reconnect', async () => {
    const tokens = new TokenManager();
    tokens.setAccessToken(jwt(300));
    const realtime = new Realtime('http://example.test', tokens);
    await connect(realtime);

    const rejected = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));
    latestSubscribeAck()({
      ok: false,
      channel: 'room',
      error: {
        code: 'REALTIME_UNAUTHORIZED',
        message: 'Not authorized to subscribe to this channel',
      },
    });
    await expect(rejected).resolves.toMatchObject({ ok: false });

    tokens.setAccessToken(jwt(600), 'signedIn');
    socket.trigger('connect');
    await vi.waitFor(() =>
      expect(
        socket.emit.mock.calls.filter(([event]) => event === 'realtime:subscribe')
      ).toHaveLength(2)
    );
    latestSubscribeAck()({ ok: true, channel: 'room', presence: { members: [] } });

    await expect(realtime.subscribe('room')).resolves.toMatchObject({ ok: true, channel: 'room' });
  });

  it('ignores an acknowledgement that arrives after a subscription timeout', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    vi.useFakeTimers();
    const subscription = realtime.subscribe('room');
    const acknowledge = latestSubscribeAck();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(subscription).resolves.toMatchObject({
      ok: false,
      error: { code: 'SUBSCRIBE_TIMEOUT' },
    });

    acknowledge({ ok: true, channel: 'room', presence: { members: [] } });
    expect((realtime as any).subscriptions.get('room')?.status).toBe('pending');
  });

  it('disposes a failed connection attempt before a later attempt starts', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    const firstConnection = realtime.connect();
    await vi.waitFor(() => expect(socket).toBeDefined());
    const failedSocket = socket;

    failedSocket.trigger('connect_error', new Error('refused'));
    await expect(firstConnection).rejects.toThrow('refused');
    expect(failedSocket.disconnect).toHaveBeenCalledOnce();

    const secondConnection = realtime.connect();
    await vi.waitFor(() => expect(socket).not.toBe(failedSocket));
    const activeSocket = socket;
    failedSocket.trigger('connect');
    expect(realtime.isConnected).toBe(false);
    activeSocket.trigger('connect');
    await expect(secondConnection).resolves.toBeUndefined();
  });

  it('updates presence state from join and leave events', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    const subscription = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));
    latestSubscribeAck()({ ok: true, channel: 'room', presence: { members: [] } });
    await subscription;
    const member = {
      type: 'user' as const,
      presenceId: 'user-1',
      joinedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(() => socket.triggerAny('presence:join', { member })).not.toThrow();
    expect(realtime.getPresenceState('room')).toEqual([]);

    const message = {
      member,
      meta: {
        channel: 'room',
        messageId: '00000000-0000-0000-0000-000000000001',
        senderType: 'system' as const,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    };

    socket.triggerAny('presence:join', message as PresenceJoinMessage);
    expect(realtime.getPresenceState('room')).toEqual([member]);

    socket.triggerAny('presence:leave', message as PresenceLeaveMessage);
    expect(realtime.getPresenceState('room')).toEqual([]);
  });

  it('re-subscribes with an acknowledgement after reconnect and replaces the presence snapshot', async () => {
    const realtime = new Realtime('http://example.test', new TokenManager());
    await connect(realtime);
    const subscription = realtime.subscribe('room');
    await vi.waitFor(() => expect(latestSubscribeAck()).toBeTypeOf('function'));
    latestSubscribeAck()({
      ok: true,
      channel: 'room',
      presence: {
        members: [{ type: 'user', presenceId: 'user-1', joinedAt: '2026-01-01T00:00:00.000Z' }],
      },
    });
    expect((realtime as any).subscriptions.get('room')?.pending).toBeUndefined();
    await subscription;

    socket.trigger('disconnect', 'transport close');
    socket.trigger('connect');

    const acknowledge = latestSubscribeAck();
    expect(acknowledge).toBeTypeOf('function');
    acknowledge({
      ok: true,
      channel: 'room',
      presence: {
        members: [{ type: 'user', presenceId: 'user-2', joinedAt: '2026-01-01T00:00:00.000Z' }],
      },
    });

    expect(realtime.getPresenceState('room')).toEqual([
      { type: 'user', presenceId: 'user-2', joinedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
