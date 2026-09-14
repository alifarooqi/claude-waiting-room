import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request } from 'node:http';
import { startWebServer, type WebServer } from '../src/server.js';
import { fakeActivity, type FakeActivity } from './fake-activity.js';

const staticDir = mkdtempSync(join(tmpdir(), 'wr-bridge-'));
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>game</title>');
mkdirSync(join(staticDir, 'sub'));
writeFileSync(join(staticDir, 'sub', 'app.js'), 'console.log("app")');
writeFileSync(join(staticDir, 'secret.txt'), 'top secret');

let web: WebServer;
let activity: FakeActivity;

beforeEach(async () => {
  activity = fakeActivity('working');
  web = await startWebServer({ activity, staticDir });
});

afterEach(async () => {
  await web.close();
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

describe('static serving & access control', () => {
  it('serves index.html at the token root with no-store', async () => {
    const res = await fetch(web.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('<title>game</title>');
  });

  it('serves nested files with a content type', async () => {
    const res = await fetch(new URL('sub/app.js', web.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toContain('app');
  });

  it('404s missing files', async () => {
    const res = await fetch(new URL('nope.js', web.url));
    expect(res.status).toBe(404);
  });

  it('403s without or with a wrong token', async () => {
    const noToken = await fetch(`http://127.0.0.1:${web.port}/`);
    expect(noToken.status).toBe(403);
    const badToken = await fetch(`http://127.0.0.1:${web.port}/t/not-the-token/`);
    expect(badToken.status).toBe(403);
  });

  it('403s requests whose Host is not our loopback origin (DNS-rebinding defense)', async () => {
    const res = await rawRequest(web.port, web.url, { Host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('403s encoded traversal attempts outside the static root', async () => {
    // %2e%2e survives URL normalization; the path containment check must not.
    const path = new URL(web.url).pathname + '%2e%2e/%2e%2e/etc/passwd';
    const res = await rawRequest(web.port, web.url, { RawPath: path });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('root:');
  });

  it('redirects the token path without trailing slash', async () => {
    const res = await fetch(web.url.replace(/\/$/, ''), { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(new URL(web.url).pathname);
  });
});

describe('actions', () => {
  it('POST focus focuses the agent terminal', async () => {
    const res = await fetch(new URL('focus', web.url), { method: 'POST' });
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(activity._focusCalls).toBe(1));
  });

  it('GET focus is rejected (405), no side effects', async () => {
    const res = await fetch(new URL('focus', web.url));
    expect(res.status).toBe(405);
    expect(activity._focusCalls).toBe(0);
  });

  it('POST quit resolves done and disposes the activity', async () => {
    const res = await fetch(new URL('quit', web.url), { method: 'POST' });
    expect(res.status).toBe(204);
    expect(await web.done).toBe('quit');
    expect(activity._disposed).toBe(true);
  });
});

describe('SSE stream', () => {
  it('streams the snapshot, then state/offline/online transitions', async () => {
    const sse = await openSse(web.url);
    try {
      const snap = await sse.next();
      expect(snap).toMatchObject({ event: 'state', data: { state: 'working', daemon: true } });

      activity._pause(); // Claude needs attention
      const paused = await sse.next();
      expect(paused).toMatchObject({ event: 'state', data: { state: 'needs_attention' } });

      activity._resume();
      const resumed = await sse.next();
      expect(resumed).toMatchObject({ event: 'state', data: { state: 'working' } });

      activity._disconnect();
      expect(await sse.next()).toMatchObject({ event: 'offline' });

      activity._reconnect();
      expect(await sse.next()).toMatchObject({ event: 'online' });
    } finally {
      sse.abort();
    }
  });

  it('delivers the offline flag in the snapshot to late joiners', async () => {
    activity._disconnect();
    const sse = await openSse(web.url);
    try {
      const snap = await sse.next();
      expect(snap.data).toMatchObject({ daemon: false });
      expect(await sse.next()).toMatchObject({ event: 'offline' });
    } finally {
      sse.abort();
    }
  });

  it('reports daemon offline from the start for degraded activities', async () => {
    const degraded = { ...fakeActivity('unknown'), live: false } as FakeActivity;
    const web2 = await startWebServer({ activity: degraded, staticDir });
    try {
      const sse = await openSse(web2.url);
      try {
        const snap = await sse.next();
        expect(snap.data).toMatchObject({ state: 'unknown', daemon: false });
      } finally {
        sse.abort();
      }
    } finally {
      await web2.close();
    }
  });
});

describe('lifecycle', () => {
  it('exits after idleExitMs with zero connected clients', async () => {
    const idle = await startWebServer({ activity: fakeActivity('working'), staticDir, idleExitMs: 150 });
    const sse = await openSse(idle.url);
    await sse.next(); // snapshot — connection truly established
    sse.abort();
    expect(await idle.done).toBe('idle');
    expect(activity._disposed).toBe(false); // separate activity, untouched
  });

  it('exits when no client ever connects (first-connect timeout)', async () => {
    const lonely = await startWebServer({
      activity: fakeActivity('working'),
      staticDir,
      firstConnectTimeoutMs: 120,
    });
    expect(await lonely.done).toBe('first-connect-timeout');
  });

  it('a reconnecting client cancels the idle exit', async () => {
    const web2 = await startWebServer({
      activity: fakeActivity('working'),
      staticDir,
      idleExitMs: 150,
    });
    try {
      const sse = await openSse(web2.url);
      await sse.next();
      sse.abort();
      await sleep(60);
      const sse2 = await openSse(web2.url);
      await sse2.next();
      // Past the idle window with a client connected: must still be running.
      await sleep(180);
      const settled = await Promise.race([web2.done.then(() => true), sleep(20).then(() => false)]);
      expect(settled).toBe(false);
      sse2.abort();
    } finally {
      await web2.close();
    }
  });

  it('close() is idempotent and resolves done as closed', async () => {
    await web.close();
    await web.close();
    expect(await web.done).toBe('closed');
  });
});

describe('startWebActivity composition', () => {
  it('creates a pane-less activity, prints the ready-line, serves the page', async () => {
    const fake = fakeActivity('working');
    const createActivity = vi.fn().mockResolvedValue(fake);
    vi.resetModules();
    vi.doMock('@waiting-room/sdk', () => ({ createActivity }));
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      // Fresh module graph so the doMock applies to server.js's import.
      const { startWebActivity: start } = await import('../src/server.js');
      const web2 = await start({
        staticDir,
        title: 'Test Game',
        openBrowser: false,
        firstConnectTimeoutMs: 60_000,
      });
      try {
        expect(createActivity).toHaveBeenCalledWith(
          expect.objectContaining({ activityPane: null, title: 'Test Game' }),
        );
        const line = stdout.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"ok":true'));
        expect(line).toBeDefined();
        const ready = JSON.parse(line!);
        expect(ready).toMatchObject({ ok: true, activity: 'Test Game', opened: false });
        expect(ready.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/t\/[\w-]+\/$/);
        const res = await fetch(ready.url);
        expect(res.status).toBe(200);
      } finally {
        await web2.close();
      }
    } finally {
      stdout.mockRestore();
      vi.doUnmock('@waiting-room/sdk');
    }
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface SseFrame {
  event?: string;
  data?: Record<string, unknown>;
}

/** Consume the /events endpoint one SSE frame at a time. */
async function openSse(url: string): Promise<{ next: (timeoutMs?: number) => Promise<SseFrame>; abort: () => void }> {
  const ac = new AbortController();
  const res = await fetch(new URL('events', url), { signal: ac.signal });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
  const queue: SseFrame[] = [];
  let waiters: Array<() => void> = [];
  let buf = '';

  void (async () => {
    try {
      for await (const chunk of res.body) {
        // undici chunks are Uint8Array — Buffer.from gets real utf8 text.
        buf += Buffer.from(chunk).toString('utf8');
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const rawFrame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const frame: SseFrame = {};
          for (const line of rawFrame.split('\n')) {
            if (line.startsWith('event: ')) frame.event = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              try {
                frame.data = JSON.parse(line.slice(6));
              } catch {
                // keep frame without data
              }
            }
          }
          if (frame.event !== undefined) queue.push(frame);
        }
        for (const w of waiters.splice(0)) w();
      }
    } catch {
      // aborted — fine
    }
  })();

  return {
    async next(timeoutMs = 3000): Promise<SseFrame> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = queue.shift();
        if (frame) return frame;
        if (Date.now() > deadline) throw new Error('timed out waiting for SSE frame');
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 25);
        });
      }
    },
    abort: () => ac.abort(),
  };
}

interface RawResult {
  status: number;
  body: string;
}

/** node:http request with full control over the raw request target/headers. */
function rawRequest(port: number, baseUrl: string, opts: { Host?: string; RawPath?: string }): Promise<RawResult> {
  return new Promise((resolveRequest, rejectRequest) => {
    const u = new URL(baseUrl);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: opts.RawPath ?? u.pathname,
        headers: opts.Host ? { Host: opts.Host } : undefined,
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString('utf8')));
        res.on('end', () => resolveRequest({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', rejectRequest);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
