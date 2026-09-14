/**
 * pickTransport — choose the right transport for the current runtime.
 *   - If globalThis.WebSocket is defined (browser, Node 22+), use WS.
 *   - Else, use the UDS IpcTransport.
 *
 * Browser-only entry: import browserPickTransport from
 * './browser-transport.js' directly to avoid loading this file at all.
 *
 * Note on browser bundles: this file's Node-only imports (transport_ipc,
 * discover) are dead code in a browser build because browsers always
 * have globalThis.WebSocket and we always take the WS path. esbuild's
 * tree-shaker can't prove this statically, so it keeps them in the
 * bundle graph; the unused Node builtins (node:net, etc.) are marked
 * external by the game build scripts so they don't pollute the output.
 */
import type { Transport, TransportOptions } from './transport.js';
import { IpcTransport } from './transport_ipc.js';
import { defaultSocketPath } from './discover.js';

declare global {
  // eslint-disable-next-line no-var
  var __WAITING_ROOM__: { ws_url?: string; session_id?: string } | undefined;
}

function browserWsUrl(): string {
  const injected =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WAITING_ROOM__?: { ws_url?: string } }).__WAITING_ROOM__
      ?.ws_url;
  if (injected) return injected;
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
      const { WebSocketTransport } = await import('./transport_websocket.js');
      return new WebSocketTransport(url, opts);
    }
  }
  const path = process.env['WAITING_ROOM_SOCKET'] || defaultSocketPath();
  return new IpcTransport(path, opts);
}
