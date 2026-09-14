/**
 * pickTransport — choose the right transport for the current runtime.
 *   - If globalThis.WebSocket is defined (browser, Node 22+), use WS
 *     against the daemon's ws_url.
 *   - Else, use the UDS IpcTransport.
 *
 * v2 browser entry: the bash shim (wr-open) injects ws_url into
 * window.__WAITING_ROOM__ at runtime, so we read it from there in
 * browsers instead of hitting the filesystem (which doesn't exist).
 *
 * Node-only imports (node:net, node:fs, ...) are loaded via dynamic
 * import() inside the Node branch, so the browser bundle never
 * references them.
 */
import type { Transport, TransportOptions } from './transport.js';

declare global {
  // eslint-disable-next-line no-var
  var __WAITING_ROOM__: { ws_url?: string; session_id?: string } | undefined;
}

function browserWsUrl(): string {
  // 1. globalThis.__WAITING_ROOM__.ws_url (injected by wr-open).
  const injected =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WAITING_ROOM__?: { ws_url?: string } }).__WAITING_ROOM__
      ?.ws_url;
  if (injected) return injected;
  // 2. globalThis.location-derived guess (last resort; mostly for manual testing).
  const g = globalThis as { location?: { protocol: string; host: string } };
  if (g.location && g.location.host) {
    const proto = g.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${g.location.host}/ws`;
  }
  return '';
}

export async function pickTransport(opts: TransportOptions): Promise<Transport> {
  const hasWS = typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined';
  if (hasWS) {
    const url = browserWsUrl();
    if (url) {
      const mod = await import('./transport_websocket.js');
      return new mod.WebSocketTransport(url, opts);
    }
  }
  // Node path — UDS. We avoid dynamic-importing transport_ipc.js /
  // discover.js at module top level so esbuild can drop them from the
  // browser bundle.
  const ipcMod = await import('./transport_ipc.js');
  const discoverMod = await import('./discover.js');
  const path = process.env['WAITING_ROOM_SOCKET'] || discoverMod.defaultSocketPath();
  return new ipcMod.IpcTransport(path, opts);
}
