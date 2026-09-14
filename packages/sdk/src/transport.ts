/**
 * Transport — a transport-agnostic abstraction over the daemon's wire
 * protocol. The SDK uses UDS (Unix Domain Socket) when running in Node,
 * and WebSocket when running in a browser. Both implementations share
 * the same reconnect/retry logic and the same JSON-lines envelope.
 *
 * pickTransport() chooses based on the runtime:
 *   - `globalThis.WebSocket` defined (browser): WS transport
 *   - else (Node): IpcTransport (uses node:net)
 */
import type {
  ClientToServer,
  ServerToClient,
} from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface TransportOptions {
  /** Per-decoded message callback. */
  onMessage: (msg: ServerToClient) => void;
  /** Fired on every (re)connect so the caller can re-send its subscribe. */
  onConnected: () => void;
  /** Fired when an established connection drops. */
  onDisconnect: () => void;
  /** Optional status changes for UI ("reconnecting…" banners). */
  onStatus?: (status: ConnectionStatus) => void;
}

export interface Transport {
  /** Begin connecting. Idempotent. */
  start(): void;
  /** Stop and release resources. */
  stop(): Promise<void>;
  /** True when the transport is connected. */
  readonly connected: boolean;
  /** Send one envelope. Returns false if not connected. */
  send(msg: ClientToServer): boolean;
}

/** parseFrames is a transport-agnostic JSON-lines framer. It works on
 *  either UDS chunks (Buffers) or WebSocket text frames (strings). */
export function parseFrames(
  incoming: string,
  buffer: { value: string },
  onMessage: (msg: ServerToClient) => void,
): void {
  buffer.value += incoming;
  let nl: number;
  while ((nl = buffer.value.indexOf('\n')) >= 0) {
    const line = buffer.value.slice(0, nl);
    buffer.value = buffer.value.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as ServerToClient;
      if (msg && (msg as { v?: number }).v === PROTOCOL_VERSION) {
        onMessage(msg);
      }
    } catch {
      // Malformed line: skip (server may be older/newer; don't crash).
    }
  }
}

/** backoffDelay: jittered exponential 100ms -> 5s cap. */
export function backoffDelay(current: number): { delay: number; next: number } {
  const delay = Math.min(current, 5000) * (0.5 + Math.random() * 0.5);
  const next = Math.min(current * 2, 5000);
  return { delay, next };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
