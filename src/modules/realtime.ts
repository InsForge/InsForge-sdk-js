import type { Socket } from 'socket.io-client';
import type {
  SubscribeResponse,
  RealtimeErrorPayload,
  SocketMessage,
  PresenceSnapshot,
  PresenceMember,
} from '@insforge/shared-schemas';
import { TokenManager } from '../lib/token-manager';
import { getJwtSubject } from '../lib/jwt';

export type { SubscribeResponse, RealtimeErrorPayload, SocketMessage, PresenceMember };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * Payload for the client-side `presence:sync` event, emitted whenever the SDK
 * receives a fresh presence snapshot for a channel (on subscribe and on every
 * automatic resubscribe after a reconnect). Rebuild presence state from
 * `presence.members` — it replaces, not extends, previously known members.
 */
export interface PresenceSyncEvent {
  channel: string;
  presence: PresenceSnapshot;
}

export type EventCallback<T = unknown> = (payload: T) => void;

const CONNECT_TIMEOUT = 10000;

// Opaque anon keys carry this prefix (see the backend socket auth middleware).
// If the format ever changes, unrecognized credentials fall through to the
// raw-token identity branch, which still compares correctly — it just stops
// short-circuiting to the shared 'anonymous' sentinel.
const ANON_KEY_PREFIX = 'anon_';

/**
 * Realtime module for subscribing to channels and handling real-time events
 *
 * @example
 * ```typescript
 * const { realtime } = client;
 *
 * // Connect to the realtime server
 * await realtime.connect();
 *
 * // Subscribe to a channel
 * const response = await realtime.subscribe('orders:123');
 * if (!response.ok) {
 *   console.error('Failed to subscribe:', response.error);
 * }
 *
 * // Listen for specific events
 * realtime.on('order_updated', (payload) => {
 *   console.log('Order updated:', payload);
 * });
 *
 * // Listen for connection events
 * realtime.on('connect', () => console.log('Connected!'));
 * realtime.on('connect_error', (err) => console.error('Connection failed:', err));
 * realtime.on('disconnect', (reason) => console.log('Disconnected:', reason));
 * realtime.on('error', (error) => console.error('Realtime error:', error));
 *
 * // Publish a message to a channel
 * await realtime.publish('orders:123', 'status_changed', { status: 'shipped' });
 *
 * // Unsubscribe and disconnect when done
 * realtime.unsubscribe('orders:123');
 * realtime.disconnect();
 * ```
 */
export class Realtime {
  private baseUrl: string;
  private tokenManager: TokenManager;
  private socket: Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectedAuthIdentity: string | null = null;
  private subscribedChannels: Set<string> = new Set();
  private pendingSubscribes: Map<string, Promise<SubscribeResponse>> = new Map();
  private presenceState: Map<string, Map<string, PresenceMember>> = new Map();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private anonKey?: string;

  constructor(baseUrl: string, tokenManager: TokenManager, anonKey?: string) {
    this.baseUrl = baseUrl;
    this.tokenManager = tokenManager;
    this.anonKey = anonKey;

    // Handle token changes (e.g., after refresh)
    this.tokenManager.onTokenChange = () => this.onTokenChange();
  }

  private notifyListeners(event: string, payload?: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) {
      return;
    }
    for (const cb of listeners) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`Error in ${event} callback:`, err);
      }
    }
  }

  /**
   * Connect to the realtime server
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void> {
    // Already connected
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    // Connection already in progress, return existing promise
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      try {
        // Reuse a socket that exists but is disconnected (e.g. between
        // reconnect attempts) — creating a second io() manager here would
        // leak the old connection and duplicate every event.
        if (this.socket) {
          await this.reconnectExistingSocket();
          return;
        }

        const { io } = await import('socket.io-client');

        await new Promise<void>((resolve, reject) => {
          const token = this.tokenManager.getAccessToken() ?? this.anonKey;
          this.connectedAuthIdentity = this.getAuthIdentity(token);

          this.socket = io(this.baseUrl, {
            transports: ['websocket'],
            auth: token ? { token } : undefined,
          });

          let initialConnection = true;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          const cleanup = () => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          };

          timeoutId = setTimeout(() => {
            if (initialConnection) {
              initialConnection = false;
              this.connectPromise = null;
              this.socket?.disconnect();
              this.socket = null;
              this.pendingSubscribes.clear();
              reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT}ms`));
            }
          }, CONNECT_TIMEOUT);

          this.socket.on('connect', () => {
            cleanup();
            // Re-subscribe to channels on every connect (initial + reconnects).
            // Each resubscribe acks with a fresh presence snapshot, surfaced
            // via 'presence:sync' so apps can rebuild presence state.
            for (const channel of this.subscribedChannels) {
              void this.requestSubscribe(channel).then((response) => {
                if (!response.ok) {
                  this.notifyListeners('error', {
                    channel,
                    code: response.error.code,
                    message: response.error.message,
                  } satisfies RealtimeErrorPayload);
                }
              });
            }
            this.notifyListeners('connect');

            if (initialConnection) {
              initialConnection = false;
              this.connectPromise = null;
              resolve();
            }
          });

          this.socket.on('connect_error', (error: Error) => {
            cleanup();
            this.notifyListeners('connect_error', error);

            if (initialConnection) {
              initialConnection = false;
              this.connectPromise = null;
              reject(error);
            }
          });

          this.socket.on('disconnect', (reason: string) => {
            this.notifyListeners('disconnect', reason);
          });

          this.socket.on('realtime:error', (error: RealtimeErrorPayload) => {
            this.notifyListeners('error', error);
          });

          // Route custom events to listeners (onAny doesn't catch socket reserved events)
          this.socket.onAny((event: string, message: SocketMessage) => {
            if (event === 'realtime:error') {
              return; // Already handled above
            }
            if (event === 'presence:join' || event === 'presence:leave') {
              this.applyPresenceDelta(event, message);
            }
            this.notifyListeners(event, message);
          });
        });
      } catch (error) {
        this.connectPromise = null;
        throw error;
      }
    })();

    return this.connectPromise;
  }

  /**
   * Reconnect an existing socket whose persistent handlers are already
   * attached. Mirrors the initial-connection semantics: resolves on connect,
   * rejects on the first connect_error (the socket keeps retrying in the
   * background), and tears the socket down on timeout.
   */
  private reconnectExistingSocket(): Promise<void> {
    const socket = this.socket!;
    this.connectedAuthIdentity = this.getAuthIdentity(
      this.tokenManager.getAccessToken() ?? this.anonKey
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (error?: Error, dropSocket = false) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        this.connectPromise = null;
        if (error) {
          if (dropSocket) {
            socket.disconnect();
            this.socket = null;
            this.pendingSubscribes.clear();
          }
          reject(error);
        } else {
          resolve();
        }
      };

      const timeoutId = setTimeout(() => {
        settle(new Error(`Connection timeout after ${CONNECT_TIMEOUT}ms`), true);
      }, CONNECT_TIMEOUT);

      const onConnect = () => settle();
      const onError = (error: Error) => settle(error);

      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
      socket.connect();
    });
  }

  /**
   * Disconnect from the realtime server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscribedChannels.clear();
    // A discarded socket's buffered emits never ack, so pending requests are dead
    this.pendingSubscribes.clear();
    this.presenceState.clear();
  }

  /**
   * Derive the logical identity behind an auth credential so token refreshes
   * for the same user can be told apart from actual identity changes.
   * JWTs map to their `sub` claim, opaque anon keys to a fixed sentinel, and
   * unrecognized credentials to their raw value (so any change reconnects).
   */
  private getAuthIdentity(token: string | null | undefined): string | null {
    if (!token) {
      return null;
    }
    if (token.startsWith(ANON_KEY_PREFIX)) {
      return 'anonymous';
    }
    return getJwtSubject(token) ?? token;
  }

  /**
   * Handle token changes (e.g., after auth refresh)
   * Updates socket auth so reconnects use the new token
   * Reconnects only when the identity changed (sign-in, sign-out, user
   * switch) — the server binds identity at handshake, so a refreshed token
   * for the same user doesn't require bouncing the live connection
   */
  private onTokenChange(): void {
    const token = this.tokenManager.getAccessToken() ?? this.anonKey;

    // Always update auth so socket.io auto-reconnect uses new token
    if (this.socket) {
      this.socket.auth = token ? { token } : {};
    }

    const identity = this.getAuthIdentity(token);
    const identityChanged = identity !== this.connectedAuthIdentity;
    // Whatever handshake happens next (reconnect or explicit connect) will
    // authenticate as this identity
    this.connectedAuthIdentity = identity;

    if (!identityChanged) {
      // Same identity with a refreshed token: re-authenticate the live
      // connection in-band so the server's view of the claims stays current.
      // Servers without the realtime:auth handler never ack, which leaves
      // the connection running on its handshake identity as before.
      if (token && this.socket?.connected) {
        this.socket.emit('realtime:auth', { token }, (response: { ok: boolean }) => {
          // The server refused the refreshed token — fall back to a full
          // reconnect so auth is renegotiated at the handshake
          if (!response?.ok && this.socket && (this.socket.connected || this.connectPromise)) {
            this.socket.disconnect();
            this.socket.connect();
          }
        });
      }
      return;
    }

    // Trigger reconnect if connected OR connecting (to avoid completing with stale token)
    if (this.socket && (this.socket.connected || this.connectPromise)) {
      this.socket.disconnect();
      this.socket.connect();
      // Note: on('connect') handler automatically re-subscribes to channels
    }
  }

  /**
   * Check if connected to the realtime server
   */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Get the current connection state
   */
  get connectionState(): ConnectionState {
    if (!this.socket) {
      return 'disconnected';
    }
    if (this.socket.connected) {
      return 'connected';
    }
    return 'connecting';
  }

  /**
   * Get the socket ID (if connected)
   */
  get socketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Emit a subscribe request for a channel and track the result.
   * On success the channel is remembered for auto-resubscribe and the fresh
   * presence snapshot is surfaced through the 'presence:sync' event; on
   * failure the channel is dropped from the auto-resubscribe list.
   *
   * In-flight requests are deduplicated per channel, so a `subscribe()` call
   * that races the automatic resubscribe on reconnect shares one round-trip
   * (and one 'presence:sync') instead of emitting twice.
   */
  private requestSubscribe(channel: string): Promise<SubscribeResponse> {
    const pending = this.pendingSubscribes.get(channel);
    if (pending) {
      return pending;
    }

    const request = new Promise<SubscribeResponse>((resolve) => {
      this.socket!.emit('realtime:subscribe', { channel }, (response: SubscribeResponse) => {
        this.pendingSubscribes.delete(channel);
        if (response.ok) {
          this.subscribedChannels.add(channel);
          this.presenceState.set(
            channel,
            new Map(response.presence.members.map((member) => [member.presenceId, member]))
          );
          this.notifyListeners('presence:sync', {
            channel: response.channel,
            presence: response.presence,
          } satisfies PresenceSyncEvent);
        } else {
          this.subscribedChannels.delete(channel);
          this.presenceState.delete(channel);
        }
        resolve(response);
      });
    });

    this.pendingSubscribes.set(channel, request);
    return request;
  }

  /**
   * Apply a presence:join/presence:leave delta to the local presence state.
   *
   * Deltas for channels without a snapshot are ignored. This is safe with the
   * current server: it takes the snapshot after adding this socket to the
   * room and emits the ack in the same synchronous block as the snapshot, so
   * a delta delivered before our ack was necessarily broadcast before the
   * snapshot was taken — the snapshot already reflects it. A delta can
   * therefore be dropped here, but never one the ack's snapshot doesn't
   * subsume.
   */
  private applyPresenceDelta(
    event: 'presence:join' | 'presence:leave',
    message: SocketMessage
  ): void {
    const { member, meta } = message as SocketMessage & { member?: PresenceMember };
    const channel = meta?.channel;
    if (!member || !channel) {
      return;
    }

    const members = this.presenceState.get(channel);
    if (!members) {
      return;
    }

    if (event === 'presence:join') {
      members.set(member.presenceId, member);
    } else {
      members.delete(member.presenceId);
    }
  }

  /**
   * Get the current presence members for a subscribed channel.
   *
   * Seeded from the subscribe snapshot and kept current by the SDK from
   * `presence:join`/`presence:leave` deltas and reconnect resyncs — no manual
   * merging needed. While disconnected this holds the last known state; it is
   * replaced by a fresh snapshot when the channel resubscribes.
   *
   * @param channel - Channel name
   * @returns Members of the channel, empty if the channel is not subscribed
   */
  getPresenceState(channel: string): PresenceMember[] {
    return Array.from(this.presenceState.get(channel)?.values() ?? []);
  }

  /**
   * Subscribe to a channel
   *
   * Automatically connects if not already connected.
   *
   * Idempotent: subscribing to an already-subscribed channel re-requests the
   * subscription and resolves the server's current presence snapshot. The
   * server tracks members per logical identity, so this never produces
   * duplicate presence entries or spurious join events.
   *
   * @param channel - Channel name (e.g., 'orders:123', 'broadcast')
   * @returns Promise with the subscription response
   */
  async subscribe(channel: string): Promise<SubscribeResponse> {
    // Auto-connect if not connected
    if (!this.socket?.connected) {
      try {
        await this.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Connection failed';
        return { ok: false, channel, error: { code: 'CONNECTION_FAILED', message } };
      }
    }

    return this.requestSubscribe(channel);
  }

  /**
   * Unsubscribe from a channel (fire-and-forget)
   *
   * @param channel - Channel name to unsubscribe from
   */
  unsubscribe(channel: string): void {
    this.subscribedChannels.delete(channel);
    this.presenceState.delete(channel);

    if (this.socket?.connected) {
      this.socket.emit('realtime:unsubscribe', { channel });
    }
  }

  /**
   * Publish a message to a channel
   *
   * @param channel - Channel name
   * @param event - Event name
   * @param payload - Message payload
   */
  async publish<T = unknown>(channel: string, event: string, payload: T): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Not connected to realtime server. Call connect() first.');
    }

    this.socket!.emit('realtime:publish', { channel, event, payload });
  }

  /**
   * Listen for events
   *
   * Reserved event names:
   * - 'connect' - Fired when connected to the server
   * - 'connect_error' - Fired when connection fails (payload: Error)
   * - 'disconnect' - Fired when disconnected (payload: reason string)
   * - 'error' - Fired when a realtime error occurs (payload: RealtimeErrorPayload)
   * - 'presence:sync' - Fired with a fresh presence snapshot for a channel,
   *   on every successful subscribe including automatic resubscribes after a
   *   reconnect (payload: PresenceSyncEvent). Rebuild presence state from it.
   *
   * All other events receive a `SocketMessage` payload with metadata.
   *
   * @param event - Event name to listen for
   * @param callback - Callback function when event is received
   */
  on<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventCallback);
  }

  /**
   * Remove a listener for a specific event
   *
   * @param event - Event name
   * @param callback - The callback function to remove
   */
  off<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventCallback);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Listen for an event only once, then automatically remove the listener
   *
   * @param event - Event name to listen for
   * @param callback - Callback function when event is received
   */
  once<T = SocketMessage>(event: string, callback: EventCallback<T>): void {
    const wrapper: EventCallback<T> = (payload: T) => {
      this.off(event, wrapper);
      callback(payload);
    };
    this.on(event, wrapper);
  }

  /**
   * Get all currently subscribed channels
   *
   * @returns Array of channel names
   */
  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }
}
