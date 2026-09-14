/**
 * IpcTransport — UDS (Unix Domain Socket) implementation of Transport.
 * Uses node:net directly. Auto-imported when running in Node (no
 * globalThis.WebSocket).
 */
import { createConnection, type Socket } from 'node:net';
import type {
  ClientToServer,
  ServerToClient,
} from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';
import {
  type Transport,
  type TransportOptions,
  type ConnectionStatus,
  parseFrames,
  backoffDelay,
  sleep,
} from './transport.js';

const CONNECT_TIMEOUT_MS = 1500;
const KEEPALIVE_MS = 30_000;

export class IpcTransport implements Transport {
  private socket?: Socket;
  private buffer = { value: '' };
  private stopped = false;
  private everConnected = false;
  private backoffMs = 100;
  private keepalive?: ReturnType<typeof setInterval>;

  constructor(
    private readonly socketPath: string,
    private readonly opts: TransportOptions,
  ) {}

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

      const sock = createConnection({ path: this.socketPath });
      this.socket = sock;
      this.buffer.value = '';
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
        clearTimeout(timer);
        established = true;
        this.everConnected = true;
        this.backoffMs = 100;
        this.opts.onStatus?.('connected');
        this.opts.onConnected();
        this.keepalive = setInterval(() => {
          this.send({ v: PROTOCOL_VERSION, type: 'ping' });
        }, KEEPALIVE_MS);
      });
      sock.on('data', (chunk: Buffer) => {
        parseFrames(chunk.toString('utf8'), this.buffer, this.opts.onMessage);
      });
      sock.on('error', () => finish());
      sock.on('close', () => finish());
    });
  }
}
