import type { Socket } from 'socket.io-client';
import type {
  PresenceMember,
  RealtimeErrorPayload,
  SocketMessage,
  SubscribeResponse,
} from '@insforge/shared-schemas';
import { TokenManager } from '../lib/token-manager';

export type { PresenceMember, RealtimeErrorPayload, SocketMessage, SubscribeResponse };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';
export type EventCallback<T = unknown> = (payload: T) => void;

type SubscriptionState = 'joining' | 'joined';

interface ChannelSubscription {
  epoch: number;
  state: SubscriptionState;
  members: Map<string, PresenceMember>;
  pending?: Promise<SubscribeResponse>;
  settlePending?: (response: SubscribeResponse) => void;
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

    this.connectPromise = (async () => {
      const { io } = await import('socket.io-client');

      await new Promise<void>((resolve, reject) => {
        this.socket = io(this.baseUrl, {
          transports: ['websocket'],
          auth: (callback) => {
            void this.getHandshakeToken().then(
              (token) => callback(token ? { token } : {}),
              () => callback({})
            );
          },
        });

        let initialConnection = true;
        let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          if (!initialConnection) {
            return;
          }
          initialConnection = false;
          this.connectPromise = null;
          this.socket?.disconnect();
          this.socket = null;
          reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT}ms`));
        }, CONNECT_TIMEOUT);

        const clearConnectTimeout = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        this.socket.on('connect', () => {
          clearConnectTimeout();
          this.resubscribeChannels();
          this.notifyListeners('connect');
          if (initialConnection) {
            initialConnection = false;
            this.connectPromise = null;
            resolve();
          }
        });

        this.socket.on('connect_error', (error: Error) => {
          clearConnectTimeout();
          this.notifyListeners('connect_error', error);
          if (initialConnection) {
            initialConnection = false;
            this.connectPromise = null;
            reject(error);
          }
        });

        this.socket.on('disconnect', (reason: string) => {
          this.handleDisconnect(reason);
        });

        this.socket.on('realtime:error', (error: RealtimeErrorPayload) => {
          this.notifyListeners('error', error);
        });

        this.socket.onAny((event: string, message: SocketMessage) => {
          if (event === 'realtime:error') {
            return;
          }
          this.applyPresenceEvent(event, message);
          this.notifyListeners(event, message);
        });
      });
    })().catch((error) => {
      this.connectPromise = null;
      throw error;
    });

    return this.connectPromise;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectPromise = null;
    for (const subscription of this.subscriptions.values()) {
      this.settleSubscription(
        subscription,
        {
          ok: false,
          channel: this.getChannel(subscription),
          error: { code: 'DISCONNECTED', message: 'Disconnected' },
        },
        false
      );
    }
    this.subscriptions.clear();
  }

  private reconnectForAuthChange(): void {
    if (!this.socket) {
      return;
    }
    this.socket.disconnect();
    this.socket.connect();
  }

  private handleDisconnect(reason: string): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.state = 'joining';
      this.settleSubscription(
        subscription,
        {
          ok: false,
          channel: this.getChannel(subscription),
          error: { code: 'DISCONNECTED', message: 'Connection lost before subscription completed' },
        },
        false
      );
    }
    this.notifyListeners('disconnect', reason);
  }

  private getChannel(subscription: ChannelSubscription): string {
    for (const [channel, candidate] of this.subscriptions) {
      if (candidate === subscription) {
        return channel;
      }
    }
    return '';
  }

  private resubscribeChannels(): void {
    for (const [channel, subscription] of this.subscriptions) {
      this.requestSubscription(channel, subscription);
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

    subscription.state = 'joining';
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
            false
          );
        }
      }, SUBSCRIBE_TIMEOUT);

      socket.emit('realtime:subscribe', { channel }, (response: SubscribeResponse) => {
        if (this.subscriptions.get(channel) !== subscription || subscription.epoch !== epoch) {
          return;
        }
        if (response.ok) {
          subscription.state = 'joined';
          subscription.members = new Map(
            response.presence.members.map((member) => [member.presenceId, member])
          );
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
    const channel = message.meta?.channel;
    const member = (message as SocketMessage & { member?: PresenceMember }).member;
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
      if (subscription.state === 'joined') {
        return { ok: true, channel, presence: { members: [...subscription.members.values()] } };
      }
    } else {
      subscription = { epoch: 0, state: 'joining', members: new Map() };
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
    return [...this.subscriptions.keys()];
  }

  getPresenceState(channel: string): PresenceMember[] {
    return [...(this.subscriptions.get(channel)?.members.values() ?? [])];
  }
}
