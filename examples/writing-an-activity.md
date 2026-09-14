# Writing your own activity

A "Waiting Room activity" is any program that subscribes to the daemon
for Claude Code lifecycle events and reacts to them. The full SDK surface
is in [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts); this
doc walks through a minimal example and the design rules.

## Choose your platform

v2 activities can be **TUI** (Node, Ink) or **browser** (HTML5 canvas or
DOM). The SDK picks the right transport automatically:

- Node clients (`createActivity()` imported normally) connect over
  the daemon's Unix Domain Socket.
- Browser clients (bundled with esbuild, `platform: 'browser'`) read
  `window.__WAITING_ROOM__.ws_url` and connect over WebSocket.

## Minimal Node example

```ts
// my-activity.ts
import { createActivity } from '@waiting-room/sdk';

const wr = await createActivity({
  session: 'auto',        // bind to the most recently active Claude session
  title: 'My Activity',   // surfaced in `waiting-room status`
});

wr.onPause(() => {
  // Claude halted, or a permission prompt is pending.
  stopMyGameLoop();
  showOverlay('Claude needs you.');
});

wr.onResume(() => {
  startMyGameLoop();
});

wr.onDisconnect(() => {
  showOverlay('Waiting Room daemon offline — auto-pause disabled.');
});

wr.onStateChange((state, info) => {
  console.log(`session=${state} (from ${info.from}, reason=${info.reason})`);
});

// On quit, hand focus back to Claude so the next session can continue.
process.on('SIGINT', async () => {
  await wr.focusClaude();
  await wr.dispose();
  process.exit(0);
});
```

Then run it in any terminal — no tmux required:

```bash
node my-activity.ts
```

## Minimal browser example

```tsx
// browser.tsx — bundled with esbuild (see packages/game-snake/scripts/build-browser.mjs)
import { createActivity } from '@waiting-room/sdk';
import { useEffect, useState } from 'react';

export function MyGame() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let dispose: () => void = () => {};
    (async () => {
      const wr = await createActivity({ session: 'auto', title: 'My Game' });
      setPaused(wr.state === 'needs_attention');
      wr.onPause(() => setPaused(true));
      wr.onResume(() => setPaused(false));
      wr.onDisconnect(() => {/* show offline banner */});
      dispose = () => { void wr.dispose(); };
    })();
    return () => dispose();
  }, []);

  return paused ? <div>Claude needs you</div> : <canvas ref={...} />;
}
```

Bundle it with esbuild (see `packages/game-snake/scripts/build-browser.mjs`).
The `window.__WAITING_ROOM__.ws_url` is injected at runtime by the
plugin's `bin/wr-open` shim — no build-time secrets.

## Design rules

1. **Never throw on connection failure.** The SDK is designed to
   degrade silently when the daemon is unreachable — your activity
   must keep running with callbacks inert. Use `onDisconnect` to
   surface the situation in the UI, not a thrown exception.

2. **Retain last-known state across disconnects.** If Claude needed
   you when the daemon dropped, the SDK keeps `state` as
   `needs_attention` (don't auto-resume when the connection returns —
   wait for a fresh state event). The SDK already does this for you;
   just don't reset it yourself.

3. **Use `auto` binding unless you have a reason.** It binds to the
   most recently active Claude session. Use `'any'` if you want to
   react to every session (uncommon), `{ session: '<id>' }` if you
   want to bind explicitly.

4. **Set `title`.** It shows up in `waiting-room status` and in the
   `bound_activities` field of the session table — invaluable when
   debugging which activity is which.

5. **Hand focus back on quit.** Call `wr.focusClaude()` in your
   exit handler. The daemon triggers the OS-level focus recovery via
   osascript on macOS (a no-op elsewhere). For TUI activities this
   brings the user's terminal to the front; for browser activities
   the user just clicks back when ready.

6. **Don't block on `onPause`/`onResume` work.** The callbacks are
   synchronous from your perspective, but the daemon runs them via
   its own goroutine — keep them quick. Heavy work should be
   debounced or scheduled.

## Testing activities

For TUI activities, use the same vitest pattern as
`@waiting-room/game-snake`:
- Render with `ink-testing-library` (or your own ink harness).
- Stub the `Activity` with a fake that records `_pause()`,
  `_resume()`, `_disconnect()` (see `fake-activity.ts`).
- Wait for both the first frame *and* callback registration (`_ready`)
  before firing fake events — otherwise the cold-scheduler race
  silently drops your first callback.

For browser activities, the renderer is unit-testable independently
(canvas logic can run in a node-canvas shim); the React shell is
testable with @testing-library/react.

## End-to-end test against a real daemon

```bash
# start the daemon (will bind an HTTP+WS listener on a random free port)
./daemon/bin/waiting-room daemon &
DAEMON_PID=$!

# run the activity in a second terminal
node ./dist/my-activity.js

# send a Stop event (simulates Claude halting)
./daemon/bin/waiting-room emit agent_needs_attention --reason stop \
    --session my-test

# expect: focus jumps to your terminal (macOS), onPause fires

# tear down
kill $DAEMON_PID
```
