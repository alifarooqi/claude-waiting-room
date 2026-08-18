/**
 * Daemon liveness probe + auto-spawn. The SDK (a long-lived process) owns
 * spawning; the one-shot `emit` client deliberately never does (hooks are
 * short-lived and must fail open fast).
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { PROTOCOL_VERSION } from './protocol.js';

/** Resolve the daemon binary: $WAITING_ROOM_BIN or "waiting-room" on PATH. */
export function daemonBinary(): string {
  return process.env['WAITING_ROOM_BIN'] || 'waiting-room';
}

/** Probe a daemon socket: connect, ping, expect any response line. */
export function daemonAlive(socketPath: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    const sock = createConnection({ path: socketPath });
    const timer = setTimeout(() => done(false), timeoutMs);
    let buf = '';
    sock.on('connect', () => {
      sock.write(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' }) + '\n');
    });
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      if (buf.includes('\n')) done(true); // hello or pong: something answers
    });
    sock.on('error', () => done(false));
    sock.on('close', () => done(false));
  });
}

/** Spawn the daemon detached, pinned to socketPath so it always lands
 *  exactly where we'll look for it (its daemon.info then advertises that
 *  socket for every other client). Resolves true if it actually started. */
export function spawnDaemon(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(daemonBinary(), ['daemon'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, WAITING_ROOM_SOCKET: socketPath },
      });
      child.once('error', () => done(false)); // e.g. ENOENT: binary missing
      child.once('spawn', () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}

/** Ensure a daemon is listening on socketPath (probe, spawn, poll). */
export async function ensureDaemon(
  socketPath: string,
  opts: { spawnEnabled: boolean; waitMs?: number },
): Promise<boolean> {
  if (await daemonAlive(socketPath)) return true;
  if (!opts.spawnEnabled) return false;
  if (!(await spawnDaemon(socketPath))) return false;
  const deadline = Date.now() + (opts.waitMs ?? 3000);
  while (Date.now() < deadline) {
    await sleep(150);
    if (await daemonAlive(socketPath)) return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
