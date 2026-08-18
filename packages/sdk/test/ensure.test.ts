import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daemonAlive, ensureDaemon } from '../src/ensure.js';

// Integration-flavored: uses the real Go binary. Skipped when it hasn't
// been built (plain `pnpm test` without `make build-daemon`).
const BIN = join(import.meta.dirname, '../../../daemon/bin/waiting-room');
const hasBin = existsSync(BIN);

describe.skipIf(!hasBin)('ensureDaemon (real binary)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wr-ensure-'));
  const sockPath = join(dir, 'daemon.sock');
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ['WAITING_ROOM_SOCKET', 'WAITING_ROOM_BIN', 'WAITING_ROOM_HOME']) {
      savedEnv[key] = process.env[key];
    }
    // Fully isolate: socket, info file, and lock all under the temp dir.
    process.env['WAITING_ROOM_HOME'] = dir;
    process.env['WAITING_ROOM_SOCKET'] = sockPath;
    process.env['WAITING_ROOM_BIN'] = BIN;
  });

  afterAll(async () => {
    // Stop the spawned daemon via its info file and PROVE it died before
    // deleting the dir — a leaked daemon would hold the lock and advertise
    // a dead socket in global state (this exact bug shipped once).
    try {
      const info = JSON.parse(readFileSync(join(dir, 'daemon.info'), 'utf8')) as { pid: number };
      process.kill(info.pid, 'SIGTERM');
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try {
          process.kill(info.pid, 0); // liveness probe
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          break; // gone
        }
      }
      try {
        process.kill(info.pid, 'SIGKILL'); // belt and braces (no-op if gone)
      } catch {
        // already dead
      }
    } catch {
      // info file absent: daemon never started or already cleaned up
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports dead, then spawns a daemon and reports alive', async () => {
    expect(await daemonAlive(sockPath)).toBe(false);
    expect(await ensureDaemon(sockPath, { spawnEnabled: true, waitMs: 5000 })).toBe(true);
    expect(await daemonAlive(sockPath)).toBe(true);
    // The spawned daemon must honor our isolation: its info file lives in
    // our temp home, never in the user's ~/.waiting-room.
    const info = JSON.parse(readFileSync(join(dir, 'daemon.info'), 'utf8')) as { socket_path: string };
    expect(info.socket_path).toBe(sockPath);
  }, 10000);
});
