import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createActivity } from '../src/activity.js';

describe('activity (degraded mode)', () => {
  beforeAll(() => {
    // Unreachable socket, spawning disabled: the SDK must degrade silently.
    process.env['WAITING_ROOM_SOCKET'] = join(tmpdir(), 'wr-degraded-absent.sock');
    process.env['WAITING_ROOM_NO_SPAWN'] = '1';
  });

  it('never throws and never fires callbacks without a daemon', async () => {
    const wr = await createActivity({ session: 'any', title: 'Lonely Game' });
    expect(wr.state).toBe('unknown');

    let fired = 0;
    wr.onPause(() => fired++);
    wr.onResume(() => fired++);
    wr.onStateChange(() => fired++);
    wr.onDisconnect(() => fired++);

    // Give any accidental connection attempt time to (not) fire.
    await new Promise((r) => setTimeout(r, 300));
    expect(fired).toBe(0);

    await wr.focusAgentTerminal(); // no-op, resolves
    await wr.dispose(); // no-op, resolves
    await wr.dispose(); // idempotent
  }, 5000);
});
