/**
 * WebSocketTransport — WebSocket implementation of Transport. Used in
 * browser bundles (where globalThis.WebSocket is the browser-native
 * class). In Node 22+ the same global is also available.
 *
 * The WS endpoint URL comes from the daemon's info file (ws_url field).
 * Sessions are bound via ?session=<id> on the upgrade; for "auto" mode
 * we bind to whatever the daemon returns in the first snapshot.
 */
import type {
  ClientToServer,
  ServerToClient,
} from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';
import {
  type Transport,
  type TransportOptions,
  backoffDelay,
  parseFrames,
  sleep,
} from './transport.js';

const KEEPALIVE_MS = 30_000;

// Minimal subset of the WebSocket interface we depend on, so the
// typechecks pass for both the browser's native WebSocket and Node's
// undici-backed global (Node 22+).
interface WSCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}
interface WSLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: WSCloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer | Blob }) => void) | null;
}

export class WebSocketTransport implements Transport {
  private ws?: WSLike;
  private buffer = { value: '' };
  private stopped = false;
  private everConnected = false;
  private backoffMs = 100;
  private keepalive?: ReturnType<typeof setInterval>;

  constructor(
    private readonly url: string,
    private readonly opts: TransportOptions,
  ) {}

  start(): void {
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.keepalive);
    try {
      this.ws?.close();
    } catch {
      // ignore close errors on already-closing sockets
    }
    this.opts.onStatus?.('stopped');
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === 1; // OPEN
  }

  send(msg: ClientToServer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(msg) + '\n');
    return true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const established = await this.runOnce();
      if (this.stopped) break;
      if (established) this.opts.onDisconnect?.();
      const { delay, next } = backoffDelay(this.backoffMs);
      this.backoffMs = next;
      this.opts.onStatus?.('reconnecting');
      await sleep(delay);
    }
  }

  private runOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.stopped) return resolve(false);
      this.opts.onStatus?.(this.everConnected ? 'reconnecting' : 'connecting');

      const WS = (globalThis as { WebSocket?: new (url: string) => WSLike }).WebSocket;
      if (!WS) {
        // No WebSocket available: fail this attempt.
        resolve(false);
        return;
      }
      const ws = new WS(this.url);
      this.ws = ws;
      this.buffer.value = '';
      let established = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(this.keepalive);
        this.ws = undefined;
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(established);
      };

      ws.onopen = () => {
        established = true;
        this.everConnected = true;
        this.backoffMs = 100;
        this.opts.onStatus?.('connected');
        this.opts.onConnected();
        this.keepalive = setInterval(() => {
          this.send({ v: PROTOCOL_VERSION, type: 'ping' });
        }, KEEPALIVE_MS);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          parseFrames(ev.data, this.buffer, this.opts.onMessage);
        }
        // Binary frames: not used in v2 protocol.
      };
      ws.onerror = () => finish();
      ws.onclose = () => finish();
    });
  }
}
