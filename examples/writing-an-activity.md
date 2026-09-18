# Writing your own activity

A "Waiting Room activity" is a web page plus a tiny bridge process: the
bridge subscribes to the daemon for Claude Code lifecycle events, serves
your page on a local ephemeral URL, and opens the user's browser. The
page reacts to Claude's state (pause/resume) and can ask the bridge to
focus Claude's terminal or shut down.

Everything you need ships in [`@waiting-room/web-bridge`](../packages/web-bridge).
The reference implementations are
[`game-snake`](../packages/game-snake) and [`exercise-math`](../packages/exercise-math).

## Minimal example

```ts
// index.ts — the bridge (this is the whole server side)
#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startWebActivity } from '@waiting-room/web-bridge';

const web = await startWebActivity({
  staticDir: join(dirname(fileURLToPath(import.meta.url)), 'web'),
  title: 'My Activity',   // surfaced in `waiting-room status`
});
await web.done;           // resolves when the tab closes / user quits
process.exit(0);
```

`staticDir` points at a directory containing `index.html` (+ your JS/CSS;
esbuild is a fine way to bundle them — see `game-snake/scripts/build-web.mjs`).

```ts
// app.ts — the browser side (bundle it into the page)
import {
  createBrowserClient,
  createPausePolicy,
  primeUserGesture,
  startAttention,
  stopAttention,
} from '@waiting-room/web-bridge/browser';

// The shared pause policy: needs_attention pauses the game, only the
// player resumes it ("resume now" / "resume & remind me in N minutes"),
// and the banner tracks whether Claude still waits or is back at work.
const pause = createPausePolicy();
pause.onChange((snap) => {
  renderPauseUI(snap); // banner variant, buttons, reminder countdown
  if (snap.attention) startAttention();
  else stopAttention();
});

const client = createBrowserClient({
  onState: (state, daemonOnline) => {
    pause.onState(state);
    setOffline(!daemonOnline);
  },
  onServerLost: () => showFarewell(),
});

// Unlock notification permission + audio on the first user gesture.
window.addEventListener('pointerdown', primeUserGesture, { once: true });

// Buttons:
await client.focusClaude(); // bring Claude's terminal forward, keep playing
await client.quit();        // same, then shut the bridge down
```

Ship it with a `bin` named `waiting-room-<game>` and the plugin's
`wr-open <game>` will find it on `PATH`, bind it to the current Claude
session, and launch it detached. That's the whole convention.

## Design rules

1. **Never throw on daemon trouble.** A missing/offline daemon means "no
   auto-pause", not "crash": the bridge serves the page anyway, the page
   shows an offline note, and everything else works. (The SDK's degraded
   mode already guarantees the callbacks simply never fire.)
2. **Treat states as absolute observations; keep resume manual.**
   `needs_attention` / `working` describe *Claude*, not your game loop:
   pause on the first, and when the second arrives let the banner say
   "Claude is working again" while the game stays paused until the player
   resumes it. React to levels (never count transitions) so a missed event
   self-heals on the next one — the bridge's 15 s state pings also resync
   you. `createPausePolicy()` implements all of this; use it.
3. **Retain state across reconnects.** The SSE stream reconnects
   automatically (2 s retry) and starts with a snapshot; your page should
   render purely from `(state, daemonOnline)` so any reconnect is a no-op
   visually.
4. **Degrade every attention effect independently.** Notification
   permission denied? Title still flashes. No audio until a gesture? The
   banner still shows. Never let one effect's absence break another —
   `startAttention()` already follows this rule; keep your own additions
   to it.
5. **Be honest about focus.** A web page cannot steal keyboard focus;
   the bridge foregrounds Claude's terminal (macOS, best effort) and the
   notification/title/favicon are the page's half. Build your "back to
   Claude" affordance on `client.focusClaude()` — never on tricks.
6. **Exit cleanly.** The bridge owns its lifecycle: `POST quit`, tab
   close (idle ~30 s), or first-connect timeout (60 s) all dispose the
   SDK subscription and close the server. Don't fight it — hook into
   `web.done` if you need cleanup.

## Testing

- Keep your game logic pure (no React, no I/O) and unit-test it directly
  (see `game.ts` / `math.ts` and their tests).
- Render your page in jsdom against a fake client — drive
  `agentState`/`daemonOnline` props like `test/web-ui.test.tsx` does in
  both reference games; no browser or daemon needed.
- The bridge itself (`@waiting-room/web-bridge`) is covered by its own
  suite; you shouldn't need to re-test SSE mechanics.
