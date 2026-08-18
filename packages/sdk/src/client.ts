/**
 * IpcClient — a resilient JSON-lines client for the daemon's Unix Domain
 * Socket: connect, frame, keep-alive, and reconnect forever with jittered
 * exponential backoff (100ms -> 5s cap). The activity keeps running while
 * disconnected; on reconnect the server delivers a fresh snapshot.
 */
import { createConnection, type Socket } from 'node:net';
import {
  PROTOCOL_VERSION,
  type ClientToServer,
  type ServerToClient,
} from './protocol.js';
import { sleep } from './ensure.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface IpcClientOptions {
  socketPath: string;
  /** Every decoded server message. */
  onMessage: (msg: ServerToClient) => void;
  /** Fired on every (re)connect so the caller can re-send its subscribe. */
  onConnected: () => void;
  /** Fired when an established connection drops. */
  onDisconnect: () => void;
  /** Optional status changes for UI ("reconnecting…" banners). */
  onStatus?: (status: ConnectionStatus) => void;
}

const CONNECT_TIMEOUT_MS = 1500;
const KEEPALIVE_MS = 30_000;

export class IpcClient {
  private socket?: Socket;
  private buffer = '';
  private stopped = false;
  private everConnected = false;
  private backoffMs = 100;
  private keepalive?: ReturnType<typeof setInterval>;

  constructor(private readonly opts: IpcClientOptions) {}

  start(): void {
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.keepalive);
    this.socket?.destroy();
    this.opts.onStatus?.('stopped');
  }

  get connected(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  send(msg: ClientToServer): boolean {
    const sock = this.socket;
    if (!sock || sock.destroyed) return false;
    sock.write(JSON.stringify(msg) + '\n');
    return true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const established = await this.runOnce();
      if (this.stopped) break;
      if (established) this.opts.onDisconnect?.();
      // Jittered exponential backoff: 100ms -> 5s cap.
      const delay = Math.min(this.backoffMs, 5000) * (0.5 + Math.random() * 0.5);
      this.backoffMs = Math.min(this.backoffMs * 2, 5000);
      this.opts.onStatus?.('reconnecting');
      await sleep(delay);
    }
  }

  /** One connection attempt; resolves when the connection ends. Returns
   *  whether the connection was ever established. */
  private runOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.stopped) return resolve(false);
      this.opts.onStatus?.(this.everConnected ? 'reconnecting' : 'connecting');

      const sock = createConnection({ path: this.opts.socketPath });
      this.socket = sock;
      this.buffer = '';
      let established = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(this.keepalive);
        this.socket = undefined;
        sock.destroy();
        resolve(established);
      };
      const timer = setTimeout(() => finish(), CONNECT_TIMEOUT_MS);

      sock.on('connect', () => {
        clearTimeout(timer); // connected: the connect-timeout must not fire
        established = true;
        this.everConnected = true;
        this.backoffMs = 100; // healthy connection: reset backoff
        this.opts.onStatus?.('connected');
        this.opts.onConnected();
        this.keepalive = setInterval(() => {
          this.send({ v: PROTOCOL_VERSION, type: 'ping' });
        }, KEEPALIVE_MS);
      });
      sock.on('data', (chunk: Buffer) => this.onData(chunk));
      sock.on('error', () => finish());
      sock.on('close', () => finish());
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as ServerToClient;
        if (msg && (msg as { v?: number }).v === PROTOCOL_VERSION) {
          this.opts.onMessage(msg);
        }
      } catch {
        // Malformed line: skip (server may be older/newer; don't crash).
      }
    }
  }
}
