/**
 * MockDaemon — a minimal in-process daemon for SDK tests: speaks the real
 * JSON-lines protocol (hello/ack/snapshot/ping/focus_request) over a UDS.
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { AgentState } from '../src/protocol.js';

interface AnyMessage {
  [k: string]: unknown;
  v: number;
  type: string;
}

export class MockDaemon {
  readonly path: string;
  readonly received: AnyMessage[] = [];
  private server?: Server;
  private clients = new Set<Socket>();
  private state: AgentState = 'unknown';

  constructor(path: string) {
    this.path = path;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((sock) => {
        this.clients.add(sock);
        this.write(sock, { v: 1, type: 'hello', server_version: 'mock' });
        let buf = '';
        sock.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as AnyMessage;
              this.received.push(msg);
              this.handle(sock, msg);
            } catch {
              // ignore malformed
            }
          }
        });
        sock.on('close', () => this.clients.delete(sock));
        sock.on('error', () => this.clients.delete(sock));
      });
      this.server.listen(this.path, () => resolve());
    });
  }

  private handle(sock: Socket, msg: AnyMessage): void {
    switch (msg.type) {
      case 'subscribe':
        this.write(sock, { v: 1, type: 'ack', ok: true });
        this.write(sock, {
          v: 1,
          type: 'snapshot',
          session_id: 's1',
          state: this.state,
          ts: new Date().toISOString(),
        });
        break;
      case 'ping':
        this.write(sock, { v: 1, type: 'pong' });
        break;
      case 'focus_request':
        this.write(sock, { v: 1, type: 'ack', ok: true });
        break;
      default:
        break;
    }
  }

  /** Push a state transition to every connected client. */
  broadcastState(to: Exclude<AgentState, 'unknown'>): void {
    const from = this.state;
    this.state = to;
    for (const c of this.clients) {
      this.write(c, {
        v: 1,
        type: 'state_change',
        session_id: 's1',
        from,
        to,
        ts: new Date().toISOString(),
      });
    }
  }

  /** Wait until a message matching pred arrives (or timeout). */
  async waitFor(pred: (m: AnyMessage) => boolean, timeoutMs = 3000): Promise<AnyMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('timed out waiting for message');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  private write(sock: Socket, obj: AnyMessage): void {
    sock.write(JSON.stringify(obj) + '\n');
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.destroy();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}
