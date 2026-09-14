// browser-transport.ts — entry point for browser bundles.
//
// esbuild's tree-shaking is module-granular: dynamic import() calls are
// not removed even when the path is unreachable. So this file exists to
// be the only thing a browser bundle imports for transport selection.
//
// Games should `import { browserPickTransport } from '@waiting-room/sdk/browser-transport'`
// from their browser.tsx entry. Node-side consumers use pick-transport.ts
// directly. The browser bundle never sees the dynamic-import() calls
// in pick-transport.ts because it doesn't import that file.

import type { Transport, TransportOptions } from './transport.js';

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

export async function browserPickTransport(opts: TransportOptions): Promise<Transport> {
  // Synchronous dynamic import so esbuild emits an IIFE that doesn't try
  // to resolve at build time. The browser always has a global WebSocket
  // so this path is always taken; the ipc/discover modules never enter
  // the bundle graph.
  const mod = (await Function('return import("./transport_websocket.js")')()) as {
    WebSocketTransport: new (url: string, opts: TransportOptions) => Transport;
  };
  return new mod.WebSocketTransport(browserWsUrl(), opts);
}
