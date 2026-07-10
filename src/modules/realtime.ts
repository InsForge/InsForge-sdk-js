import type { Socket } from 'socket.io-client';
import type {
  PresenceMember,
  PresenceJoinMessage,
  PresenceLeaveMessage,
  RealtimeErrorPayload,
  SocketMessage,
  SubscribeResponse,
} from '@insforge/shared-schemas';
import { TokenManager } from '../lib/token-manager';

export type { PresenceMember, RealtimeErrorPayload, SocketMessage, SubscribeResponse };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';
export type EventCallback<T = unknown> = (payload: T) => void;

type SubscriptionStatus = 'pending' | 'subscribed' | 'rejected';

interface ChannelSubscription {
  channel: string;
  epoch: number;
  status: SubscriptionStatus;
  members: Map<string, PresenceMember>;
  pending?: Promise<SubscribeResponse>;
  settlePending?: (response: SubscribeResponse) => void;
}

interface ConnectionAttempt {
  id: number;
  socket: Socket;
  cancel: (error: Error) => void;
}

const CONNECT_TIMEOUT = 10_000;
const SUBSCRIBE_TIMEOUT = 10_000;

/**
 * Socket.IO realtime client. Authentication is evaluated for every handshake,
 * while an established socket remains authenticated until it disconnects.
 */
export class Realtime {
  private socket: Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectionAttempt: ConnectionAttempt | null = null;
  private nextConnectionAttemptId = 0;
  private subscriptions = new Map<string, ChannelSubscription>();
  private eventListeners = new Map<string, Set<EventCallback>>();

  constructor(
    private baseUrl: string,
    private tokenManager: TokenManager,
    private anonKey?: string,
    private getValidAccessToken: () => Promise<string | null> = async () =>
      tokenManager.getAccessToken()
  ) {
    this.tokenManager.onAuthStateChange((event) => {
      if (event !== 'tokenRefreshed') {
        this.reconnectForAuthChange();
      }
    });
  }

  private notifyListeners(event: string, payload?: unknown): void {
    for (const callback of this.eventListeners.get(event) ?? []) {
      try {
        callback(payload);
      } catch (error) {
        console.error(`Error in ${event} callback:`, error);
      }
    }
  }

  private async getHandshakeToken(): Promise<string | null> {
    return (await this.getValidAccessToken()) ?? this.anonKey ?? null;
  }

  connect(): Promise<void> {
    if (this.socket?.connected) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const attemptId = ++this.nextConnectionAttemptId;
    const connection = (async () => {
      const { io } = await import('socket.io-client');
      if (attemptId !== this.nextConnectionAttemptId) {
        throw new Error('Connection cancelled');
      }

      await new Promise<void>((resolve, reject) => {
        const socket = io(this.baseUrl, {
          transports: ['websocket'],
          auth: (callback) => {
            void this.getHandshakeToken().then(
              (token) => callback(token ? { token } : {}),
              () => callback({})
            );
          },
        });
        this.socket = socket;

        let initialConnection = true;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const clearConnectTimeout = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        const dispose = () => {
          clearConnectTimeout();
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
          socket.off('disconnect', onDisconnect);
          socket.off('realtime:error', onRealtimeError);
          socket.offAny(onAny);
          socket.disconnect();
          if (this.socket === socket) {
            this.socket = null;
          }
          if (this.connectionAttempt?.id === attemptId) {
            this.connectionAttempt = null;
          }
        };

        const fail = (error: Error) => {
          if (!initialConnection) {
            return;
          }
          initialConnection = false;
          dispose();
          reject(error);
        };

        const onConnect = () => {
          if (this.socket !== socket) {
            return;
          }
          clearConnectTimeout();
          this.resubscribeChannels();
          this.notifyListeners('connect');
          if (initialConnection) {
            initialConnection = false;
            if (this.connectionAttempt?.id === attemptId) {
              this.connectionAttempt = null;
            }
            resolve();
          }
        };

        const onConnectError = (error: Error) => {
          clearConnectTimeout();
          this.notifyListeners('connect_error', error);
          if (initialConnection) {
            fail(error);
          }
        };

        const onDisconnect = (reason: string) => {
          this.handleDisconnect(reason);
        };

        const onRealtimeError = (error: RealtimeErrorPayload) => {
          this.notifyListeners('error', error);
        };

        const onAny = (event: string, message: SocketMessage) => {
          if (event === 'realtime:error') {
            return;
          }
          this.applyPresenceEvent(event, message);
          this.notifyListeners(event, message);
        };

        this.connectionAttempt = { id: attemptId, socket, cancel: fail };
        socket.on('connect', onConnect);
        socket.on('connect_error', onConnectError);
        socket.on('disconnect', onDisconnect);
        socket.on('realtime:error', onRealtimeError);
        socket.onAny(onAny);
        timeoutId = setTimeout(
          () => fail(new Error(`Connection timeout after ${CONNECT_TIMEOUT}ms`)),
          CONNECT_TIMEOUT
        );
      });
    })();

    const trackedConnection = connection.finally(() => {
      if (this.connectPromise === trackedConnection) {
        this.connectPromise = null;
      }
    });
    this.connectPromise = trackedConnection;
    return trackedConnection;
  }

  disconnect(): void {
    this.nextConnectionAttemptId++;
    this.connectionAttempt?.cancel(new Error('Disconnected'));
    this.socket?.disconnect();
    this.socket = null;
    this.connectPromise = null;
    for (const subscription of this.subscriptions.values()) {
      this.settleSubscription(
        subscription,
        {
          ok: false,
          channel: subscription.channel,
          error: { code: 'DISCONNECTED', message: 'Disconnected' },
        },
        false
      );
    }
    this.subscriptions.clear();
  }

  private reconnectForAuthChange(): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.status === 'rejected') {
        subscription.status = 'pending';
      }
    }
    if (!this.socket) {
      return;
    }
    this.socket.disconnect();
    this.socket.connect();
  }

  private handleDisconnect(reason: string): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.status === 'rejected') {
        continue;
      }
      subscription.status = 'pending';
      this.settleSubscription(
        subscription,
        {
          ok: false,
          channel: subscription.channel,
          error: { code: 'DISCONNECTED', message: 'Connection lost before subscription completed' },
        },
        false
      );
    }
    this.notifyListeners('disconnect', reason);
  }

  private resubscribeChannels(): void {
    for (const [channel, subscription] of this.subscriptions) {
      if (subscription.status === 'pending') {
        this.requestSubscription(channel, subscription);
      }
    }
  }

  private requestSubscription(
    channel: string,
    subscription: ChannelSubscription
  ): Promise<SubscribeResponse> {
    if (subscription.pending) {
      return subscription.pending;
    }
    const socket = this.socket;
    if (!socket?.connected) {
      return Promise.resolve({
        ok: false,
        channel,
        error: { code: 'CONNECTION_FAILED', message: 'Not connected to realtime server' },
      });
    }

    subscription.status = 'pending';
    const epoch = ++subscription.epoch;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    subscription.pending = new Promise<SubscribeResponse>((resolve) => {
      subscription.settlePending = (response) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        subscription.pending = undefined;
        subscription.settlePending = undefined;
        resolve(response);
      };

      timeoutId = setTimeout(() => {
        if (this.subscriptions.get(channel) === subscription && subscription.epoch === epoch) {
          this.settleSubscription(
            subscription,
            {
              ok: false,
              channel,
              error: {
                code: 'SUBSCRIBE_TIMEOUT',
                message: 'Subscription acknowledgement timed out',
              },
            },
            true
          );
        }
      }, SUBSCRIBE_TIMEOUT);

      socket.emit('realtime:subscribe', { channel }, (response: SubscribeResponse) => {
        if (this.subscriptions.get(channel) !== subscription || subscription.epoch !== epoch) {
          return;
        }
        if (response.ok) {
          subscription.status = 'subscribed';
          subscription.members = new Map(
            response.presence.members.map((member) => [member.presenceId, member])
          );
        } else {
          subscription.status = 'rejected';
          subscription.members.clear();
        }
        this.settleSubscription(subscription, response, false);
      });
    });
    return subscription.pending;
  }

  private settleSubscription(
    subscription: ChannelSubscription,
    response: SubscribeResponse,
    incrementEpoch: boolean
  ): void {
    if (incrementEpoch) {
      subscription.epoch++;
    }
    subscription.settlePending?.(response);
  }

  private applyPresenceEvent(event: string, message: SocketMessage): void {
    if (event !== 'presence:join' && event !== 'presence:leave') {
      return;
    }
    const presenceEvent = message as PresenceJoinMessage | PresenceLeaveMessage;
    const channel = presenceEvent.meta?.channel;
    const member = presenceEvent.member;
    if (!channel || !member) {
      return;
    }
    const subscription = this.subscriptions.get(channel);
    if (!subscription) {
      return;
    }
    if (event === 'presence:join') {
      subscription.members.set(member.presenceId, member);
    } else {
      subscription.members.delete(member.presenceId);
    }
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  get connectionState(): ConnectionState {
    if (!this.socket) {
      return 'disconnected';
    }
    return this.socket.connected ? 'connected' : 'connecting';
  }

  get socketId(): string | undefined {
    return this.socket?.id;
  }

  async subscribe(channel: string): Promise<SubscribeResponse> {
    let subscription = this.subscriptions.get(channel);
    if (subscription) {
      if (subscription.pending) {
        return subscription.pending;
      }
      if (subscription.status === 'subscribed') {
        return { ok: true, channel, presence: { members: [...subscription.members.values()] } };
      }
    } else {
      subscription = { channel, epoch: 0, status: 'pending', members: new Map() };
      this.subscriptions.set(channel, subscription);
    }

    if (!this.socket?.connected) {
      try {
        await this.connect();
      } catch (error) {
        if (this.subscriptions.get(channel) === subscription) {
          this.subscriptions.delete(channel);
        }
        const message = error instanceof Error ? error.message : 'Connection failed';
        return { ok: false, channel, error: { code: 'CONNECTION_FAILED', message } };
      }
    }

    return subscription.pending ?? this.requestSubscription(channel, subscription);
  }

  unsubscribe(channel: string): void {
    const subscription = this.subscriptions.get(channel);
    if (!subscription) {
      return;
    }
    this.subscriptions.delete(channel);
    this.settleSubscription(
      subscription,
      {
        ok: false,
        channel,
        error: { code: 'SUBSCRIPTION_CANCELLED', message: 'Subscription cancelled' },
      },
      true
    );
    if (this.socket?.connected) {
      this.socket.emit('realtime:unsubscribe', { channel });
    }
  }

  async publish<T = unknown>(channel: string, event: string, payload: T): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Not connected to realtime server. Call connect() first.');
    }
    this.socket.emit('realtime:publish', { channel, event, payload });
  }

  on<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    const listeners = this.eventListeners.get(event) ?? new Set<EventCallback>();
    listeners.add(callback as EventCallback);
    this.eventListeners.set(event, listeners);
  }

  off<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    const listeners = this.eventListeners.get(event);
    listeners?.delete(callback as EventCallback);
    if (listeners?.size === 0) {
      this.eventListeners.delete(event);
    }
  }

  once<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    const wrapper: EventCallback<T> = (payload) => {
      this.off(event, wrapper);
      callback(payload);
    };
    this.on(event, wrapper);
  }

  getSubscribedChannels(): string[] {
    // Only server-confirmed subscriptions are active. Pending retries and
    // server-rejected intents remain internal until they are explicitly retried.
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.status === 'subscribed')
      .map((subscription) => subscription.channel);
  }

  getPresenceState(channel: string): PresenceMember[] {
    return [...(this.subscriptions.get(channel)?.members.values() ?? [])];
  }
}
