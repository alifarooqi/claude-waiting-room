# @waiting-room/web-bridge

Turn a Waiting Room side activity into a **local web page**: your game
runs in the user's browser while Claude Code works, pausing when Claude
needs attention and resuming when Claude gets back to it — no terminal
pane, no tmux.

The bridge is a small Node process that:

1. subscribes to the Waiting Room daemon over the existing UDS SDK
   (`@waiting-room/sdk`, pane-less binding),
2. serves your static web bundle + a live SSE state stream on an
   **ephemeral `127.0.0.1` port behind a random URL token**,
3. opens the OS browser,
4. exits by itself when the tab closes (or the user quits in-page).

Design: `docs/adr/0004-web-activities.md`.

## Server side

```ts
import { startWebActivity } from '@waiting-room/web-bridge';

const web = await startWebActivity({
  staticDir: new URL('../dist/web/', import.meta.url).pathname,
  title: 'Snake',
  // session: '<claude session_id>',   // omit → $WAITING_ROOM_SESSION / auto
  // openBrowser: false,               // --no-open
});

await web.done;  // resolves 'quit' | 'idle' | 'first-connect-timeout' | 'closed'
process.exit(0);
```

`startWebActivity` prints a one-line JSON **ready-line** to stdout right
after listening — the contract launchers poll for:

```json
{"ok":true,"url":"http://127.0.0.1:53126/t/dG9rZW4.../","port":53126,"activity":"Snake","opened":true}
```

Lifecycle (all configurable, timers never hold the process open):

| Option | Default | Meaning |
| --- | --- | --- |
| `firstConnectTimeoutMs` | 60 000 | exit if no page ever connects |
| `idleExitMs` | 30 000 | exit once the last page disconnects |
| `port` | ephemeral | fixed port for debugging |
| `openBrowser` | `true` | set `false` and print the URL instead |

`SIGINT`/`SIGTERM` shut the bridge down cleanly (second signal
force-exits). `startWebServer()` is also exported for embedding around an
existing `Activity`.

## Browser side

```ts
import {
  createBrowserClient,
  primeUserGesture,
  startAttention,
  stopAttention,
} from '@waiting-room/web-bridge/browser';

const client = createBrowserClient({
  onState: (state, daemonOnline) => setBanner(state === 'needs_attention'),
  onOffline: () => showOfflineNote(),
});

// once, on first pointerdown/keydown: unlock notifications + audio
window.addEventListener('pointerdown', primeUserGesture, { once: true });

// "Claude needs you" effects: title flash, red favicon, notification, beep
startAttention();
// when Claude resumes:
stopAttention();

// buttons:
await client.focusClaude(); // ask the bridge to focus Claude's terminal
await client.quit();        // focus + shut the bridge down
```

Attention effects degrade independently and never throw; a browser page
cannot steal OS focus, so the bridge **also** foregrounds Claude's
terminal app at the `needs_attention` transition when it can identify it
(`$WAITING_ROOM_TERMINAL_APP`, set by `wr-open`; opt out with
`$WAITING_ROOM_NO_FOCUS_RECOVER=1`).

## Security posture

Loopback-only ephemeral port, 128-bit random token in the URL path
(403 without it), `Host` must be the exact `127.0.0.1`/`localhost` origin
(DNS-rebinding defense), `Cache-Control: no-store`, no CORS headers. Same
single-user workstation threat model as the daemon — see
`docs/security-uds.md`.
