/**
 * The web-bridge server: serves an activity's web bundle plus a live
 * state stream on an ephemeral 127.0.0.1 port, guarded by a random URL
 * token. Design: docs/adr/0004-web-activities.md — the daemon is not
 * involved in HTTP; this process subscribes over the existing UDS SDK.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createActivity, type Activity, type AgentState } from '@waiting-room/sdk';
import { activateApp, openBrowser } from './open.js';

export type WebExitReason = 'quit' | 'idle' | 'first-connect-timeout' | 'closed';

const PING_MS = 15_000;
const DEFAULT_FIRST_CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_EXIT_MS = 30_000;

export interface WebServerOptions {
  /** The SDK activity whose state drives the SSE stream. */
  readonly activity: Activity;
  /** Directory holding the web bundle; `index.html` is the entry point. */
  readonly staticDir: string;
  /** Fixed port for debugging (default: pick a free ephemeral port). */
  readonly port?: number;
  /** Exit if no client ever connects within this window (default 60s; 0 disables). */
  readonly firstConnectTimeoutMs?: number;
  /** Exit after this long with zero connected clients, once one has
   *  connected (default 30s; 0 disables). */
  readonly idleExitMs?: number;
}

export interface WebServer {
  /** Page URL: http://127.0.0.1:<port>/t/<token>/ */
  readonly url: string;
  readonly port: number;
  /** Resolves when the bridge should exit (quit posted, tab closed and
   *  idle, first-connect timeout, or close()). */
  readonly done: Promise<WebExitReason>;
  /** Graceful shutdown; also resolves `done` as 'closed'. Idempotent. */
  close(): Promise<void>;
}

/**
 * Start the HTTP/SSE server around an existing Activity. Most activities
 * want `startWebActivity` (below), which also creates the activity,
 * prints the ready-line, and opens the browser.
 */
export function startWebServer(options: WebServerOptions): Promise<WebServer> {
  return new Promise((resolveStarted, rejectStarted) => {
    const { activity, staticDir } = options;
    const token = randomBytes(16).toString('base64url'); // 128-bit
    const clients = new Set<ServerResponse>();

    let port = options.port ?? 0;
    let hadClient = false;
    let finished = false;
    let finishReason: WebExitReason | undefined;
    let closedPromise: Promise<void> | undefined;
    let daemonOnline = true;
    let firstConnectTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    let doneResolve!: (reason: WebExitReason) => void;
    const done = new Promise<WebExitReason>((r) => {
      doneResolve = r;
    });

    const server: Server = createServer((req, res) => {
      handle(req, res).catch(() => {
        try {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('internal error\n');
        } catch {
          // socket already gone
        }
      });
    });

    server.on('error', (err) => {
      if (!finished) rejectStarted(err);
      finish('closed');
    });

    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectStarted(new Error('unexpected listen address'));
        return;
      }
      port = addr.port;

      // Wire the activity to the stream.
      activity.onStateChange((state) => {
        broadcast('state', statePayload(state));
        // Focus recovery: Claude halted — bring its terminal forward
        // (best effort, macOS; in-page effects are the fallback).
        if (state === 'needs_attention') void activateTerminalApp();
      });
      activity.onDisconnect(() => {
        daemonOnline = false;
        broadcast('offline', {});
      });
      activity.onReconnect(() => {
        daemonOnline = true;
        broadcast('online', {});
      });

      // Keepalives double as periodic full resync: a missed event heals
      // within one ping interval.
      pingTimer = setInterval(() => {
        for (const res of clients) {
          writeFrame(res, undefined, undefined, ': ping');
          writeFrame(res, 'state', statePayload(activity.state));
        }
      }, PING_MS);
      pingTimer.unref();

      const firstMs = options.firstConnectTimeoutMs ?? DEFAULT_FIRST_CONNECT_TIMEOUT_MS;
      if (firstMs > 0) {
        firstConnectTimer = setTimeout(() => finish('first-connect-timeout'), firstMs);
        firstConnectTimer.unref();
      }

      resolveStarted({
        url: `http://127.0.0.1:${port}/t/${token}/`,
        port,
        done,
        close: () => {
          finish('closed');
          return closedPromise ?? Promise.resolve();
        },
      });
    });

    function statePayload(state: AgentState): { state: AgentState; daemon: boolean } {
      return { state, daemon: daemonOnline };
    }

    function writeFrame(
      res: ServerResponse,
      event: string | undefined,
      data: unknown,
      comment?: string,
    ): void {
      let frame = comment ? `${comment}\n` : '';
      if (event !== undefined) frame += `event: ${event}\n`;
      if (data !== undefined) frame += `data: ${JSON.stringify(data)}\n`;
      res.write(frame + '\n');
    }

    function broadcast(event: string, data: unknown): void {
      for (const res of clients) writeFrame(res, event, data);
    }

    function finish(reason: WebExitReason): void {
      if (finished) return;
      finished = true;
      if (firstConnectTimer !== undefined) clearTimeout(firstConnectTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (pingTimer !== undefined) clearInterval(pingTimer);
      for (const res of clients) res.end();
      clients.clear();
      closedPromise = (async () => {
        server.close(); // stop accepting
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        await activity.dispose().catch(() => undefined);
      })();
      doneResolve(reason);
    }

    // ------------------------------------------------------------------
    // HTTP handling
    // ------------------------------------------------------------------

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // DNS-rebinding defense: only our own loopback origin may talk to us.
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        reply(res, 403, 'text/plain', 'forbidden\n');
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      } catch {
        reply(res, 400, 'text/plain', 'bad request\n');
        return;
      }

      const prefix = `/t/${token}/`;
      if (url.pathname === `/t/${token}`) {
        res.writeHead(301, { Location: prefix });
        res.end();
        return;
      }
      if (!url.pathname.startsWith(prefix)) {
        reply(res, 403, 'text/plain', 'forbidden\n');
        return;
      }

      let rest: string;
      try {
        rest = decodeURIComponent(url.pathname.slice(prefix.length));
      } catch {
        reply(res, 400, 'text/plain', 'bad request\n');
        return;
      }

      if (rest === 'events') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          reply(res, 405, 'text/plain', 'method not allowed\n');
          return;
        }
        startSse(req, res);
        return;
      }
      if (rest === 'focus' || rest === 'quit') {
        if (req.method !== 'POST') {
          reply(res, 405, 'text/plain', 'method not allowed\n');
          return;
        }
        res.writeHead(204);
        res.end();
        if (rest === 'focus') {
          void focusTerminal();
        } else {
          finish('quit');
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        reply(res, 405, 'text/plain', 'method not allowed\n');
        return;
      }
      await serveStatic(rest, res);
    }

    function focusTerminal(): Promise<void> {
      return activity
        .focusAgentTerminal()
        .catch(() => undefined)
        .then(() => activateTerminalApp());
    }

    function startSse(req: IncomingMessage, res: ServerResponse): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);

      // Immediate snapshot (+ offline state, if that's the current truth).
      writeFrame(res, 'state', statePayload(activity.state));
      if (!daemonOnline) writeFrame(res, 'offline', {});

      hadClient = true;
      if (firstConnectTimer !== undefined) {
        clearTimeout(firstConnectTimer);
        firstConnectTimer = undefined;
      }
      clearIdle();

      req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0 && hadClient && !finished) armIdle();
      });
    }

    function armIdle(): void {
      const idleMs = options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS;
      if (idleMs <= 0) return;
      clearIdle();
      idleTimer = setTimeout(() => finish('idle'), idleMs);
      idleTimer.unref();
    }

    function clearIdle(): void {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    }

    async function serveStatic(rest: string, res: ServerResponse): Promise<void> {
      const root = resolve(staticDir);
      const rel = rest === '' ? 'index.html' : rest.replace(/^\/+/, '');
      // Containment: resolve and require the target to stay under root.
      const target = resolve(root, rel);
      if (target !== root && !target.startsWith(root + sep)) {
        reply(res, 403, 'text/plain', 'forbidden\n');
        return;
      }
      let st;
      try {
        st = await stat(target);
        if (st.isDirectory()) st = await stat(resolve(target, 'index.html'));
      } catch {
        reply(res, 404, 'text/plain', 'not found\n');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType(extname(target)),
        'Content-Length': st.size,
      });
      // HEAD requests: Node drops the response body for us.
      const stream = createReadStream(target);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }

    function reply(
      res: ServerResponse,
      status: number,
      type: string,
      body: string,
    ): void {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    }

    function contentType(ext: string): string {
      switch (ext) {
        case '.html':
        case '.htm':
          return 'text/html; charset=utf-8';
        case '.js':
        case '.mjs':
          return 'text/javascript; charset=utf-8';
        case '.css':
          return 'text/css; charset=utf-8';
        case '.json':
        case '.map':
          return 'application/json; charset=utf-8';
        case '.svg':
          return 'image/svg+xml';
        case '.png':
          return 'image/png';
        case '.jpg':
        case '.jpeg':
          return 'image/jpeg';
        case '.ico':
          return 'image/x-icon';
        case '.woff2':
          return 'font/woff2';
        case '.wasm':
          return 'application/wasm';
        default:
          return 'application/octet-stream';
      }
    }

  });
}

// ---------------------------------------------------------------------------
// startWebActivity — the composition games actually use
// ---------------------------------------------------------------------------

export interface WebActivityOptions {
  /** Directory holding the built web bundle (`index.html` et al.). */
  readonly staticDir: string;
  /** Activity label surfaced in `waiting-room status`. */
  readonly title: string;
  /** Explicit Claude session id to bind this activity to. */
  readonly session?: string;
  /** Open the browser automatically (default true). */
  readonly openBrowser?: boolean;
  /** Fixed port for debugging (default: ephemeral). */
  readonly port?: number;
  readonly firstConnectTimeoutMs?: number;
  readonly idleExitMs?: number;
}

export interface WebActivity extends WebServer {
  readonly activity: Activity;
}

/**
 * Create the SDK activity (pane-less — a web page is not a tmux pane),
 * serve it, print the ready-line, and open the browser. The ready-line
 * is a single JSON object on stdout — the contract `wr-open` polls for:
 *
 *   {"ok":true,"url":"http://127.0.0.1:PORT/t/TOKEN/","port":PORT,
 *    "activity":"Snake","opened":true}
 *
 * Installs SIGINT/SIGTERM handlers that shut the bridge down cleanly.
 */
export async function startWebActivity(options: WebActivityOptions): Promise<WebActivity> {
  const activity = await createActivity({
    session: options.session ? { session: options.session } : undefined,
    title: options.title,
    activityPane: null,
  });

  const server = await startWebServer({
    activity,
    staticDir: options.staticDir,
    port: options.port,
    firstConnectTimeoutMs: options.firstConnectTimeoutMs,
    idleExitMs: options.idleExitMs,
  });

  const web: WebActivity = { ...server, activity };

  let opened = false;
  if (options.openBrowser !== false) opened = await openBrowser(server.url);

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      url: server.url,
      port: server.port,
      activity: options.title,
      opened,
    })}\n`,
  );

  // Ctrl-C / kill: shut down cleanly (second signal force-exits).
  let signals = 0;
  const onSignal = (): void => {
    signals += 1;
    if (signals === 1) void web.close();
    else process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  void web.done.then(() => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  });

  return web;
}

/**
 * Best-effort "bring Claude's terminal to the foreground" (macOS focus
 * recovery). The terminal app name is discovered by `wr-open` from the
 * process ancestry of the Claude session and exported as
 * $WAITING_ROOM_TERMINAL_APP; without it, the in-page notification and
 * banners remain the attention mechanism. Set
 * $WAITING_ROOM_NO_FOCUS_RECOVER=1 to opt out entirely.
 */
function activateTerminalApp(): Promise<void> {
  if (process.env['WAITING_ROOM_NO_FOCUS_RECOVER'] === '1') return Promise.resolve();
  const app = process.env['WAITING_ROOM_TERMINAL_APP'];
  return activateApp(app ?? '').then(() => undefined, () => undefined);
}
