import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscribeResponse } from '@insforge/shared-schemas';
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
}

let socket: FakeSocket;
let socketOptions: { auth?: unknown } | undefined;

const io = vi.fn((_url: string, options: { auth?: unknown }) => {
  socketOptions = options;
  socket = new FakeSocket();
  return socket;
});

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
    socket = undefined as never;
    socketOptions = undefined;
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
    expect(realtime.getSubscribedChannels()).toEqual(['room']);

    socket.trigger('connect');
    const acknowledge = latestSubscribeAck();
    acknowledge({ ok: true, channel: 'room', presence: { members: [] } });

    await expect(realtime.subscribe('room')).resolves.toMatchObject({ ok: true, channel: 'room' });
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
