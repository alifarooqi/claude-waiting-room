import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivity } from '../src/activity.js';
import { MockDaemon } from './mock-daemon.js';

const dir = mkdtempSync(join(tmpdir(), 'wr-sdk-'));
const sockPath = join(dir, 'daemon.sock');

describe('activity (live daemon)', () => {
  let mock: MockDaemon;

  beforeEach(async () => {
    process.env['WAITING_ROOM_SOCKET'] = sockPath;
    process.env['WAITING_ROOM_NO_SPAWN'] = '1';
    // A fresh mock per test: no state or history leaks between tests.
    mock = new MockDaemon(sockPath);
    await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('connects, subscribes with its pane info, and syncs state', async () => {
    const wr = await createActivity({ session: 'any', title: 'Connect Test' });
    // Match on title: this mock's history is shared across tests, so a bare
    // type match could resolve against an earlier test's subscribe.
    const sub = await mock.waitFor((m) => m.type === 'subscribe' && m['title'] === 'Connect Test');
    expect(sub['activity_id']).toMatch(/^connect-test-/);
    expect(sub['mode']).toBe('any');
    expect(wr.state).toBe('unknown'); // snapshot said unknown
    await wr.dispose();
  }, 5000);

  it('fires onPause/onResume/onStateChange on transitions', async () => {
    const wr = await createActivity({ session: 'any', title: 'Transitions Test' });
    await mock.waitFor((m) => m.type === 'subscribe' && m['title'] === 'Transitions Test');

    let paused = 0;
    let resumed = 0;
    const seen: string[] = [];
    wr.onPause(() => paused++);
    wr.onResume(() => resumed++);
    wr.onStateChange((s, info) => seen.push(`${info.from}->${s}`));

    mock.broadcastState('needs_attention');
    await vi_waitUntil(() => paused === 1);
    expect(wr.state).toBe('needs_attention');

    mock.broadcastState('working');
    await vi_waitUntil(() => resumed === 1);
    expect(wr.state).toBe('working');
    expect(seen).toEqual(['unknown->needs_attention', 'needs_attention->working']);
    await wr.dispose();
  }, 5000);

  it('focusAgentTerminal sends a focus_request', async () => {
    const wr = await createActivity({ session: 'any', title: 'Focus Test' });
    await mock.waitFor((m) => m.type === 'subscribe' && m['title'] === 'Focus Test');
    await wr.focusAgentTerminal();
    await mock.waitFor((m) => m.type === 'focus_request');
    await wr.dispose();
  }, 5000);

  it('reconnects after the daemon restarts and re-syncs', async () => {
    const wr = await createActivity({ session: 'any', title: 'Reconnect Test' });
    // Wait for THIS activity's subscribe (title-scoped) so we know the
    // connection is truly established before killing the mock daemon.
    await mock.waitFor((m) => m.type === 'subscribe' && m['title'] === 'Reconnect Test');

    let disconnects = 0;
    let paused = 0;
    wr.onDisconnect(() => disconnects++);
    wr.onPause(() => paused++);

    // Kill the "daemon"; the activity must keep running (no throw).
    await mock.stop();
    await vi_waitUntil(() => disconnects === 1, 4000);
    expect(wr.state).toBe('unknown');

    // Daemon comes back; the client re-subscribes (backoff ~100ms).
    const mock2 = new MockDaemon(sockPath);
    await mock2.start();
    await mock2.waitFor((m) => m.type === 'subscribe' && m['title'] === 'Reconnect Test', 4000);

    // And state events flow again.
    mock2.broadcastState('needs_attention');
    await vi_waitUntil(() => paused === 1, 4000);
    await wr.dispose();
    await mock2.stop();
  }, 10000);
});

/** Tiny poll-until helper (avoids importing test utils everywhere). */
async function vi_waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('condition not met before timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
