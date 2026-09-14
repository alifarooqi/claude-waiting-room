/**
 * pickTransport — choose the right transport for the current runtime.
 *   - If globalThis.WebSocket is defined (browser, Node 22+), use WS
 *     against the daemon's advertised ws_url.
 *   - Else, use the UDS IpcTransport.
 *
 * The browser bundle (built with esbuild's platform:'browser') drops
 * the IpcTransport import entirely via the conditional require below
 * (the require() is dynamic and only resolves if globalThis.WebSocket
 * is undefined).
 */
import type { Transport, TransportOptions } from './transport.js';
import { wsUrlFromInfo } from './discover.js';

export async function pickTransport(opts: TransportOptions): Promise<Transport> {
  const hasWS = typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined';
  if (hasWS) {
    const url = wsUrlFromInfo();
    if (url) {
      const mod = await import('./transport_websocket.js');
      return new mod.WebSocketTransport(url, opts);
    }
  }
  const mod = await import('./transport_ipc.js');
  // Default UDS path: caller-supplied via env or the info file.
  const { defaultSocketPath } = await import('./discover.js');
  const path = process.env['WAITING_ROOM_SOCKET'] || defaultSocketPath();
  return new mod.IpcTransport(path, opts);
}
