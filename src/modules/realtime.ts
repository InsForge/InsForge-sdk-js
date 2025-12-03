import { io, Socket } from 'socket.io-client';
import type { SubscribeResponse, RealtimeErrorPayload, SocketMessage, SocketMessageMeta } from '@insforge/shared-schemas';
import { TokenManager } from '../lib/token-manager';

export type { SubscribeResponse, RealtimeErrorPayload, SocketMessage, SocketMessageMeta };

export interface RealtimeConfig {
  /**
   * Custom Socket.IO path
   * @default '/socket.io'
   */
  path?: string;

  /**
   * Auto-connect when first subscribing
   * @default false
   */
  autoConnect?: boolean;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export type EventCallback<T = unknown> = (payload: T) => void;

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
  private config: RealtimeConfig;
  private socket: Socket | null = null;
  private subscribedChannels: Set<string> = new Set();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  constructor(baseUrl: string, tokenManager: TokenManager, config: RealtimeConfig = {}) {
    this.baseUrl = baseUrl;
    this.tokenManager = tokenManager;
    this.config = { autoConnect: false, ...config };
  }

  private notifyListeners(event: string, payload?: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
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
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      const session = this.tokenManager.getSession();
      const token = session?.accessToken;

      this.socket = io(this.baseUrl, {
        path: this.config.path,
        transports: ['websocket'],
        auth: token ? { token } : undefined,
      });

      let initialConnection = true;

      this.socket.on('connect', () => {
        // Re-subscribe to channels on every connect (initial + reconnects)
        for (const channel of this.subscribedChannels) {
          this.socket!.emit('realtime:subscribe', { channel });
        }
        this.notifyListeners('connect');

        if (initialConnection) {
          initialConnection = false;
          resolve();
        }
      });

      this.socket.on('connect_error', (error: Error) => {
        this.notifyListeners('connect_error', error);

        if (initialConnection) {
          initialConnection = false;
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
      this.socket.onAny((event: string, payload: unknown) => {
        if (event === 'realtime:error') return; // Already handled above
        this.notifyListeners(event, payload);
      });
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
    if (!this.socket) return 'disconnected';
    if (this.socket.connected) return 'connected';
    return 'connecting';
  }

  /**
   * Get the socket ID (if connected)
   */
  get socketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Subscribe to a channel
   *
   * @param channel - Channel name (e.g., 'orders:123', 'broadcast')
   * @returns Promise with the subscription response
   */
  async subscribe(channel: string): Promise<SubscribeResponse> {
    if (!this.socket?.connected) {
      if (this.config.autoConnect) {
        await this.connect();
      } else {
        return { ok: false, channel, error: { code: 'NOT_CONNECTED', message: 'Not connected to realtime server' } };
      }
    }

    return new Promise((resolve) => {
      this.socket!.emit('realtime:subscribe', { channel }, (response: SubscribeResponse) => {
        if (response.ok) {
          this.subscribedChannels.add(channel);
        }
        resolve(response);
      });
    });
  }

  /**
   * Unsubscribe from a channel (fire-and-forget)
   *
   * @param channel - Channel name to unsubscribe from
   */
  unsubscribe(channel: string): void {
    this.subscribedChannels.delete(channel);

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
      if (this.config.autoConnect) {
        await this.connect();
      } else {
        throw new Error('Not connected to realtime server');
      }
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
   *
   * @param event - Event name to listen for
   * @param callback - Callback function when event is received
   */
  on<T = unknown>(event: string, callback: EventCallback<T>): void {
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
  off<T = unknown>(event: string, callback: EventCallback<T>): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventCallback);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
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
