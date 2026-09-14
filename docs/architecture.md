# Architecture

Waiting Room observes Claude Code's lifecycle and coordinates side activities + OS-level focus recovery around it.

## Components

- **Daemon** (`daemon/`, Go) — a long-lived process exposing two transports:
  - **Unix Domain Socket** (existing) for local CLI clients (`emit`, `watch`, `status`) and Node-based activities.
  - **HTTP + WebSocket** on `127.0.0.1:0` (random free port) for browser-based activities.
  - The daemon owns the **session registry** (per-Claude `session_id` state machine), the **event bus** (in-memory pub/sub to activity clients), the **focus controller** (osascript on macOS, no-op elsewhere), auth (UDS peer-credentials), and lifecycle.
- **`waiting-room emit`** — a one-shot client mode of the same binary, invoked by Claude Code hooks. Reads `session_id` from the hook's stdin payload, sends one event to the daemon, and **always exits 0** (fails open).
- **SDK** (`@waiting-room/sdk`, TS) — activity authors subscribe and react via `onPause()` / `onResume()` / `onStateChange()`. Owns `ensureDaemon()` and degraded-mode behavior. Auto-picks UDS (Node) or WebSocket (browser) transport.
- **plugin-claude** — ships `hooks/hooks.json` mapping `UserPromptSubmit` → working, `Stop`/`Notification` → needs attention, plus the `/waiting-room:start <game>` slash skill that opens browser games via `bin/wr-open`.
- **Reference activities** — Snake (HTML5 Canvas) + math quiz (DOM), plus legacy Ink TUI variants.

## State machine (per session)

```
        UserPromptSubmit              Stop / Notification
UNKNOWN ─────────────────▶ WORKING ─────────────────▶ NEEDS_ATTENTION
   ▲                         ▲                              │
   │                         └──────── UserPromptSubmit ────┘
   └──────── GC (stale >5min) ──────────┘
```

States are **absolute declarations**: `Stop` fully defines NEEDS_ATTENTION, `UserPromptSubmit` fully defines WORKING. A missed event is therefore self-healing — the next event restores correct state. No durable queue is required.

## Separation of concerns

- **Focus recovery** (osascript → bring terminal to front) is the **daemon's** job.
- **Pause/resume** of the activity loop is the **activity's** job (via SDK callbacks).

This keeps each side independently testable.

## Binding an activity to a session (multi-instance)

When several Claude instances run at once, each has a unique `session_id`. An activity that subscribes with `mode: 'auto'` is bound to the most recently active Claude session. Pause is per-session; focus is global — bringing the user's terminal to the foreground is the same regardless of which Claude instance halted.

## Transport

The wire format is **JSON-lines with versioned envelopes** (`{ "v": 1, "type": "…", … }`). The same bytes are carried over either transport:

- **Unix Domain Socket** — newline-delimited JSON frames. Peer-credential auth (Linux `SO_PEERCRED`, macOS `LOCAL_PEERCRED`) prevents cross-user access on shared hosts.
- **HTTP + WebSocket** — one text frame per envelope. Bound to `127.0.0.1` only. `Origin` header must match the listener's host (or be absent for non-browser clients like the SDK).

See [ADR-0002](adr/0002-json-lines-wire-format.md) for the wire format and [ADR-0007](adr/0007-drop-tmux.md) for the v1→v2 transport decision.

## Browser activities

Games are bundled as static HTML/JS/CSS in `~/.waiting-room/web/<name>/` (installed via `npm install -g @waiting-room/game-<name>`). The plugin's `bin/wr-open <game>` script:

1. Reads `~/.waiting-room/daemon.info` for `{ web_url, ws_url }`.
2. Copies the game bundle's `index.html` to a tmpfile.
3. Injects `window.__WAITING_ROOM__ = { ws_url, session_id }` via the `<!--{{WR_CONFIG}}-->` placeholder.
4. Calls `open <tmpfile>` (macOS) to launch the user's default browser.

The browser bundle subscribes to the daemon over WebSocket and runs entirely client-side. Closing the tab → WS disconnect → daemon GC the subscription. No leftover processes.

## v2 limitations

- **macOS only** for OS-level focus recovery. Linux/Windows can use everything else (browser games, pause/resume, status) — only the auto-focus-back step is a no-op.
- **Single-user hosts only.** UDS peer-credentials reject foreign UIDs but don't isolate multiple users on the same box.
- **No offline support.** Activities degrade silently (no auto-pause) when the daemon is unreachable.
