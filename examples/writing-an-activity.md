# Writing your own activity

A "Waiting Room activity" is any program that subscribes to the daemon
for Claude Code lifecycle events and reacts to them. The full SDK surface
is in [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts); this
doc walks through a minimal example and the design rules.

## Minimal example

```ts
// my-activity.ts
import { createActivity } from '@waiting-room/sdk';

const wr = await createActivity({
  session: 'auto',        // bind by tmux window topology (recommended)
  title: 'My Activity',   // surfaced in `waiting-room status`
});

wr.onPause(() => {
  // Claude halted, or a permission prompt is pending.
  stopMyGameLoop();
  showOverlay('Claude needs you — focus will jump to Claude pane.');
});

wr.onResume(() => {
  startMyGameLoop(); // Claude is back at work.
});

wr.onDisconnect(() => {
  // Daemon unreachable: keep running, optionally show a banner.
  showOverlay('Waiting Room daemon offline — auto-pause disabled.');
});

wr.onStateChange((state, info) => {
  console.log(`session=${state} (from ${info.from}, reason=${info.reason})`);
});

// On quit, hand focus back to Claude so the next session can continue.
process.on('SIGINT', async () => {
  await wr.focusAgentTerminal();
  await wr.dispose();
  process.exit(0);
});
```

Then run it inside a tmux pane (it'll bind to the Claude session in the
same window):

```bash
node my-activity.ts
```

## Design rules

1. **Never throw on connection failure.** The SDK is designed to degrade
   silently when the daemon is unreachable — your activity must keep
   running with callbacks inert. Use `onDisconnect` to surface the
   situation in the UI, not a thrown exception.

2. **Retain last-known state across disconnects.** If Claude needed you
   when the daemon dropped, the SDK keeps `state` as `needs_attention`
   (don't auto-resume when the connection returns — wait for a fresh
   state event). The SDK already does this for you; just don't reset it
   yourself.

3. **Use `auto` binding unless you have a reason.** It binds to the
   Claude session sharing your tmux window — which is exactly what you
   want when your activity lives next to Claude in the same split.
   Use `'any'` if you want to react to every session (uncommon),
   `{ session: '<id>' }` if you want to bind explicitly.

4. **Set `title`.** It shows up in `waiting-room status` and in the
   `bound_activities` field of the session table — invaluable when
   debugging which activity is which.

5. **Report your pane + socket on subscribe.** The SDK does this
   automatically from `$TMUX` / `$TMUX_PANE` env, which are inherited
   when you launch from inside a tmux pane. If you launch elsewhere,
   set `spawnDaemon: false` and `activity_pane` explicitly on the
   wire (advanced).

6. **Hand focus back on quit.** Call `wr.focusAgentTerminal()` in your
   SIGINT handler. If you don't, the user is left staring at a dead
   activity pane after they exit.

7. **Don't block on `onPause`/`onResume` work.** The callbacks are
   synchronous from your perspective, but the daemon runs them via its
   own goroutine — keep them quick. Heavy work should be debounced or
   scheduled.

## Advanced: imperative focus

The SDK exposes `wr.focusAgentTerminal()` for one-off focus requests
(e.g. a "back to Claude" button). This goes through the daemon's
`focus_request` message and uses the same tmux topology rules as
state-driven focus.

## Testing activities

Use the same vitest pattern as `@waiting-room/game-snake`:
- Render with `ink-testing-library` (or your own ink harness — see
  `packages/game-snake/test/ink-render.ts` for a minimal one).
- Stub the `Activity` with a fake that records `_pause()`,
  `_resume()`, `_disconnect()` (see `fake-activity.ts`).
- Wait for both the first frame *and* callback registration (`_ready`)
  before firing fake events — otherwise the cold-scheduler race
  silently drops your first callback.

## End-to-end test against a real daemon

```bash
# in tmux, split a pane:
tmux new -s demo -d
tmux split-window -h -t demo

# in the right pane:
./daemon/bin/waiting-room daemon &
node ./dist/my-activity.js

# in the left pane:
WAITING_ROOM_SOCKET=$XDG_RUNTIME_DIR/waiting-room/daemon.sock \
  TMUX=$TMUX TMUX_PANE=%0 \
  ./daemon/bin/waiting-room emit agent_working --session my-test

# expect: focus jumps to your activity pane, onPause fires
```
